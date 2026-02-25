/**
 * IB Helper - GAS Proxy Client
 *
 * Frontend module for Google Sign-In (email only) + GAS doPost() proxy.
 * Replaces OAuth2 spreadsheets scope with simple identity verification.
 *
 * @version 1.2.2
 * @author 100xFenok Claude
 * @feature #258 (no more "unverified app" warning)
 * @feature #226 (7-day session persistence via HMAC tokens)
 *
 * FLOW:
 *   1. User clicks sign-in → Google One Tap or button
 *   2. Google returns JWT id_token (email only, no sensitive scope)
 *   3. Frontend sends id_token to GAS doPost({action:'login'})
 *   4. GAS verifies token, returns HMAC session token (7-day)
 *   5. All Sheets ops go through gasProxy.request(action, params)
 *
 * CHANGELOG:
 * - v1.2.1 (2026-02-25): Lazy GIS load for manual-email path (defer One Tap script until needed)
 * - v1.2.0 (2026-02-24): Manual email login + pending sign-in cleanup + switch rollback safety
 * - v1.1.0 (2026-02-23): Account-switch hardening (force chooser + fallback button wiring)
 * - v1.0.0 (2026-02-21): Initial release — Sign-In + session + fetch wrapper
 */

const GasProxy = (function() {
  'use strict';

  // =====================================================
  // CONFIGURATION
  // =====================================================

  const PROXY_CLIENT_CONFIG = {
    CLIENT_ID: '1047143661358-3pd4f9o20tmp2u2dejskbdhrrs1tgmuo.apps.googleusercontent.com',
    WEBAPP_URL: 'https://script.google.com/macros/s/AKfycbz2oCTIJyMFyAKUqoaZfcHMDz46rUEcSNFXnq2VDnXIKsdJcUl4oQQT6_FHRoeDyQAA/exec',
    MAX_RETRIES: 2,
    TIMEOUT_MS: 30000,
    RETRY_BASE_DELAY_MS: 1000
  };

  // =====================================================
  // STATE
  // =====================================================

  const SESSION_KEY = 'ib_helper_proxy_session';
  const EMAIL_KEY = 'ib_helper_proxy_email';

  let _sessionToken = null;
  let _email = null;
  let _initialized = false;
  let _signInCallback = null;  // called after successful login
  let _signOutCallback = null; // called after sign out
  let _pendingSignInResolve = null;  // resolve for signIn() promise
  let _pendingSignInReject = null;   // reject for signIn() promise
  let _signInTimeoutId = null;       // timeout for signIn() promise
  let _gisReady = false;
  let _gisLoadPromise = null;

  function _normalizeEmail(raw) {
    return String(raw || '').trim().toLowerCase();
  }

  function _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
  }

  function _resetPendingSignIn(error) {
    if (_signInTimeoutId) {
      clearTimeout(_signInTimeoutId);
      _signInTimeoutId = null;
    }
    if (_pendingSignInReject) {
      try {
        _pendingSignInReject(error || new Error('Sign-in cancelled'));
      } catch (e) {
        // ignore
      }
    }
    _pendingSignInResolve = null;
    _pendingSignInReject = null;
  }

  // =====================================================
  // INITIALIZATION
  // =====================================================

  /**
   * Initialize GasProxy: load GIS script + restore session from localStorage.
   *
   * @param {Object} opts
   * @param {Function} opts.onSignIn - callback(email) after successful sign-in
   * @param {Function} opts.onSignOut - callback() after sign-out
   * @returns {Promise<boolean>} true if session was restored
   */
  async function init(opts) {
    opts = opts || {};
    _signInCallback = opts.onSignIn || null;
    _signOutCallback = opts.onSignOut || null;
    var shouldPreloadGis = opts.preloadGis !== false;

    // Restore session from localStorage
    var restored = _restoreSession();

    // Optional GIS preload (manual login path can skip)
    if (shouldPreloadGis) {
      await _loadGisScript();
    }

    _initialized = true;

    if (restored && _signInCallback) {
      _signInCallback(_email);
    }

    return restored;
  }

  /**
   * Load Google Identity Services script.
   * Only loads the sign-in part (google.accounts.id), NOT oauth2.
   */
  function _loadGisScript() {
    if (_gisReady && typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      return Promise.resolve();
    }

    if (_gisLoadPromise) {
      return _gisLoadPromise;
    }

    _gisLoadPromise = new Promise(function(resolve, reject) {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        try {
          google.accounts.id.initialize({
            client_id: PROXY_CLIENT_CONFIG.CLIENT_ID,
            callback: _handleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: false
          });
          _gisReady = true;
          resolve();
        } catch (e) {
          _gisLoadPromise = null;
          reject(e);
        }
        return;
      }

      var script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = function() {
        try {
          google.accounts.id.initialize({
            client_id: PROXY_CLIENT_CONFIG.CLIENT_ID,
            callback: _handleCredentialResponse,
            auto_select: false,
            cancel_on_tap_outside: false
          });
          _gisReady = true;
          resolve();
        } catch (e) {
          _gisLoadPromise = null;
          reject(e);
        }
      };
      script.onerror = function() {
        _gisLoadPromise = null;
        reject(new Error('Failed to load Google Identity Services'));
      };
      document.body.appendChild(script);
    });

    return _gisLoadPromise;
  }

  // =====================================================
  // SIGN-IN / SIGN-OUT
  // =====================================================

  /**
   * Trigger Google Sign-In prompt (One Tap).
   * Returns a Promise that resolves with email after successful login.
   * For browsers that block FedCM, use renderButton() as fallback.
   *
   * @returns {Promise<string>} Resolves with user email on success
   */
  function signIn(options) {
    options = options || {};
    var forceAccountSelect = !!options.forceAccountSelect;
    var fallbackContainer = options.buttonContainer || null;
    var onFallbackShown = typeof options.onFallbackShown === 'function' ? options.onFallbackShown : null;
    var onPromptStarted = typeof options.onPromptStarted === 'function' ? options.onPromptStarted : null;
    var manualEmail = _normalizeEmail(options.manualEmail || '');

    if (!_initialized) {
      return Promise.reject(new Error('GasProxy: Not initialized. Call init() first.'));
    }

    if (manualEmail) {
      if (_sessionToken && _email && _normalizeEmail(_email) === manualEmail && !forceAccountSelect) {
        if (_signInCallback) _signInCallback(_email);
        return Promise.resolve(_email);
      }
      _resetPendingSignIn(new Error('Sign-in replaced by manual login.'));
      return _manualSignInByEmail(manualEmail);
    }

    return _loadGisScript().then(function() {
      if (forceAccountSelect) {
        _prepareAccountSwitch();
      }

      // If already signed in, just notify
      if (_sessionToken && _email && !forceAccountSelect) {
        if (_signInCallback) _signInCallback(_email);
        return Promise.resolve(_email);
      }

      // Return a promise that resolves when _handleCredentialResponse completes
      return new Promise(function(resolve, reject) {
        _resetPendingSignIn(new Error('Sign-in replaced by a new attempt.'));
        _pendingSignInResolve = resolve;
        _pendingSignInReject = reject;

        // Give enough time for account chooser interaction + manual fallback button.
        _signInTimeoutId = setTimeout(function() {
          _pendingSignInResolve = null;
          _pendingSignInReject = null;
          _signInTimeoutId = null;
          reject(new Error('Sign-in timeout (120s)'));
        }, 120000);

        // Trigger One Tap prompt
        if (onPromptStarted) {
          try { onPromptStarted(); } catch (e) {}
        }
        google.accounts.id.prompt(function(notification) {
          var isNotDisplayed = notification.isNotDisplayed && notification.isNotDisplayed();
          var isSkipped = notification.isSkippedMoment && notification.isSkippedMoment();
          var isDismissed = notification.isDismissedMoment && notification.isDismissedMoment();

          if (isNotDisplayed || isSkipped || isDismissed) {
            var reasons = [];
            if (notification.getNotDisplayedReason) {
              var notDisplayedReason = notification.getNotDisplayedReason();
              if (notDisplayedReason) reasons.push(notDisplayedReason);
            }
            if (notification.getSkippedReason) {
              var skippedReason = notification.getSkippedReason();
              if (skippedReason) reasons.push(skippedReason);
            }
            if (notification.getDismissedReason) {
              var dismissedReason = notification.getDismissedReason();
              if (dismissedReason) reasons.push(dismissedReason);
            }

            var reasonText = reasons.length > 0 ? reasons.join(' / ') : 'unknown';
            console.log('GasProxy: One Tap not shown (' + reasonText + '). Using fallback button if available.');

            if (fallbackContainer) {
              renderButton(fallbackContainer);
              if (onFallbackShown) {
                try { onFallbackShown(reasonText); } catch (e) {}
              }
            } else if (onFallbackShown) {
              try { onFallbackShown(reasonText); } catch (e) {}
            }
          }
        });
      });
    });
  }

  async function _manualSignInByEmail(email) {
    if (!_isValidEmail(email)) {
      throw new Error('유효한 이메일 형식이 아닙니다.');
    }

    var previousToken = _sessionToken;
    var previousEmail = _email;

    try {
      var result = await _fetchGAS({
        action: 'manualLogin',
        params: { email: email }
      });

      if (!result.ok) {
        throw new Error(result.error || '수동 로그인 실패');
      }

      var resolvedEmail = _normalizeEmail(result?.data?.email || email);
      _sessionToken = result.sessionToken;
      _email = resolvedEmail;
      _saveSession();

      if (_signInCallback) {
        _signInCallback(_email);
      }

      return _email;
    } catch (error) {
      _sessionToken = previousToken;
      _email = previousEmail;
      if (_sessionToken && _email) {
        _saveSession();
      } else {
        _clearSession();
      }
      throw error;
    }
  }

  /**
   * Render a sign-in button in a container element.
   * Fallback for when One Tap is blocked (Safari, incognito).
   *
   * @param {HTMLElement|string} container - DOM element or element ID
   */
  function renderButton(container) {
    var el = typeof container === 'string' ? document.getElementById(container) : container;
    if (!el) {
      console.warn('GasProxy.renderButton: container not found');
      return;
    }
    el.innerHTML = '';
    google.accounts.id.renderButton(el, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      logo_alignment: 'left'
    });
  }

  /**
   * Prepare account switching without dropping current session immediately.
   * Current session is kept until new sign-in succeeds, to avoid lockout on cancel/failure.
   * Revoke is best-effort only; failures should not block sign-in.
   */
  function _prepareAccountSwitch() {
    var previousEmail = _email;

    _resetPendingSignIn(new Error('Sign-in cancelled by account switch.'));

    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.disableAutoSelect();
      } catch (e) {
        console.warn('GasProxy: disableAutoSelect failed:', e);
      }

      if (previousEmail && google.accounts.id.revoke) {
        try {
          google.accounts.id.revoke(previousEmail, function() {
            console.log('GasProxy: Revoked Google credential for', previousEmail);
          });
        } catch (e2) {
          console.warn('GasProxy: revoke failed (ignored):', e2);
        }
      }
    }
  }

  /**
   * Handle credential response from Google Sign-In.
   * Sends id_token to GAS for verification + session creation.
   */
  async function _handleCredentialResponse(response) {
    if (!response || !response.credential) {
      console.error('GasProxy: No credential in response');
      return;
    }

    try {
      // Send id_token to GAS for verification
      var result = await _fetchGAS({
        action: 'login',
        params: { idToken: response.credential }
      });

      if (!result.ok) {
        throw new Error(result.error || 'Login failed');
      }

      _sessionToken = result.sessionToken;
      _email = result.data.email;
      _saveSession();

      console.log('GasProxy: Logged in as', _email);

      if (_signInCallback) {
        _signInCallback(_email);
      }

      // Resolve pending signIn() promise
      if (_pendingSignInResolve) {
        clearTimeout(_signInTimeoutId);
        var resolve = _pendingSignInResolve;
        _pendingSignInResolve = null;
        _pendingSignInReject = null;
        _signInTimeoutId = null;
        resolve(_email);
      }
    } catch (error) {
      console.error('GasProxy: Login error:', error);
      _clearSession();

      // Reject pending signIn() promise
      if (_pendingSignInReject) {
        clearTimeout(_signInTimeoutId);
        var reject = _pendingSignInReject;
        _pendingSignInResolve = null;
        _pendingSignInReject = null;
        _signInTimeoutId = null;
        reject(error);
      }
    }
  }

  /**
   * Sign out: clear session + revoke Google credential.
   */
  function signOut() {
    var previousEmail = _email;
    _resetPendingSignIn(new Error('Sign-in cancelled by sign-out.'));
    _clearSession();

    // Revoke Google credential to ensure clean re-login
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      try {
        google.accounts.id.disableAutoSelect();
      } catch (e) {
        console.warn('GasProxy: disableAutoSelect failed:', e);
      }
      if (previousEmail && google.accounts.id.revoke) {
        try {
          google.accounts.id.revoke(previousEmail, function() {
            console.log('GasProxy: Signed out + revoked', previousEmail);
          });
        } catch (e2) {
          console.warn('GasProxy: revoke failed (ignored):', e2);
        }
      }
    }

    if (_signOutCallback) {
      _signOutCallback();
    }

    console.log('GasProxy: Signed out');
  }

  /**
   * Check if user is signed in with a valid session.
   * @returns {boolean}
   */
  function isAuthenticated() {
    return !!_sessionToken && !!_email;
  }

  /**
   * Get current user email.
   * @returns {string|null}
   */
  function getUserEmail() {
    return _email;
  }

  // =====================================================
  // SESSION MANAGEMENT
  // =====================================================

  function _saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, _sessionToken);
      localStorage.setItem(EMAIL_KEY, _email);
    } catch (e) {
      console.warn('GasProxy: Failed to save session:', e);
    }
  }

  function _restoreSession() {
    try {
      var token = localStorage.getItem(SESSION_KEY);
      var email = localStorage.getItem(EMAIL_KEY);
      if (token && email) {
        _sessionToken = token;
        _email = email;
        console.log('GasProxy: Session restored for', email);
        return true;
      }
    } catch (e) {
      console.warn('GasProxy: Failed to restore session:', e);
    }
    return false;
  }

  function _clearSession() {
    _sessionToken = null;
    _email = null;
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(EMAIL_KEY);
    } catch (e) {
      // ignore
    }
  }

  /**
   * Update session token from GAS response (rolling refresh).
   */
  function _refreshToken(newToken) {
    if (newToken) {
      _sessionToken = newToken;
      _saveSession();
    }
  }

  // =====================================================
  // FETCH WRAPPER
  // =====================================================

  /**
   * Send a request to GAS doPost().
   *
   * @param {Object} body - { action, params, sessionToken? }
   * @param {number} retryCount - current retry attempt
   * @returns {Promise<Object>} GAS response { ok, data, sessionToken, error, code }
   */
  async function _fetchGAS(body, retryCount) {
    retryCount = retryCount || 0;

    // Attach session token (except for login)
    if (body.action !== 'login' && body.action !== 'manualLogin' && _sessionToken) {
      body.sessionToken = _sessionToken;
    }

    var controller = new AbortController();
    var timeoutId = setTimeout(function() {
      controller.abort();
    }, PROXY_CLIENT_CONFIG.TIMEOUT_MS);

    try {
      var response = await fetch(PROXY_CLIENT_CONFIG.WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // GAS web apps redirect (302/303) then return 200
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }

      var result = await response.json();

      // Handle 401: session expired
      if (result.code === 401) {
        console.warn('GasProxy: Session expired, clearing...');
        _clearSession();
        if (_signOutCallback) _signOutCallback();
        throw new Error('Session expired. Please sign in again.');
      }

      // Rolling token refresh
      if (result.sessionToken) {
        _refreshToken(result.sessionToken);
      }

      return result;

    } catch (error) {
      clearTimeout(timeoutId);

      // Retry on network errors (not on 401 or abort)
      if (error.name !== 'AbortError' &&
          !error.message.includes('Session expired') &&
          retryCount < PROXY_CLIENT_CONFIG.MAX_RETRIES) {
        var delay = PROXY_CLIENT_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
        console.warn('GasProxy: Retrying in ' + delay + 'ms (attempt ' + (retryCount + 1) + ')');
        await new Promise(function(resolve) { setTimeout(resolve, delay); });
        return _fetchGAS(body, retryCount + 1);
      }

      throw error;
    }
  }

  // =====================================================
  // PUBLIC REQUEST API
  // =====================================================

  /**
   * Make a proxied request to GAS.
   *
   * @param {string} action - Action name (e.g., 'readPortfolio', 'writePortfolio')
   * @param {string|null} sheetContext - Not used (kept for API compatibility)
   * @param {Object} params - Action-specific parameters
   * @returns {Promise<Object>} { ok, data, error }
   */
  async function request(action, sheetContext, params) {
    if (!_sessionToken) {
      throw new Error('Not signed in. Call GasProxy.signIn() first.');
    }

    return _fetchGAS({
      action: action,
      params: params || {}
    });
  }

  // =====================================================
  // PUBLIC API
  // =====================================================

  return {
    init: init,
    signIn: signIn,
    signOut: signOut,
    renderButton: renderButton,
    isAuthenticated: isAuthenticated,
    getUserEmail: getUserEmail,
    request: request,

    // Expose for debugging
    _config: PROXY_CLIENT_CONFIG
  };

})();

// Export for testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GasProxy;
}
