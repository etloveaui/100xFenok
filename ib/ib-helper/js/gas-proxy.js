/**
 * IB Helper - GAS Proxy Client
 *
 * Frontend module for Google Sign-In (email only) + GAS doPost() proxy.
 * Replaces OAuth2 spreadsheets scope with simple identity verification.
 *
 * @version 1.0.0
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

    // Restore session from localStorage
    var restored = _restoreSession();

    // Load GIS script (needed for sign-in button/prompt)
    await _loadGisScript();

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
    return new Promise(function(resolve, reject) {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
        resolve();
        return;
      }

      var script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = function() {
        google.accounts.id.initialize({
          client_id: PROXY_CLIENT_CONFIG.CLIENT_ID,
          callback: _handleCredentialResponse,
          auto_select: true,
          cancel_on_tap_outside: false
        });
        resolve();
      };
      script.onerror = function() {
        reject(new Error('Failed to load Google Identity Services'));
      };
      document.body.appendChild(script);
    });
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
  function signIn() {
    if (!_initialized) {
      return Promise.reject(new Error('GasProxy: Not initialized. Call init() first.'));
    }

    // If already signed in, just notify
    if (_sessionToken && _email) {
      if (_signInCallback) _signInCallback(_email);
      return Promise.resolve(_email);
    }

    // Return a promise that resolves when _handleCredentialResponse completes
    return new Promise(function(resolve, reject) {
      _pendingSignInResolve = resolve;
      _pendingSignInReject = reject;

      // 60s timeout for the entire sign-in flow
      _signInTimeoutId = setTimeout(function() {
        _pendingSignInResolve = null;
        _pendingSignInReject = null;
        _signInTimeoutId = null;
        reject(new Error('Sign-in timeout (60s)'));
      }, 60000);

      // Trigger One Tap prompt
      google.accounts.id.prompt(function(notification) {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          console.log('GasProxy: One Tap not shown (' + notification.getNotDisplayedReason() +
            ' / ' + notification.getSkippedReason() + '). Use renderButton fallback.');
        }
      });
    });
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
    google.accounts.id.renderButton(el, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      logo_alignment: 'left'
    });
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
    _clearSession();

    // Revoke Google credential to ensure clean re-login
    if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
      google.accounts.id.disableAutoSelect();
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
    if (body.action !== 'login' && _sessionToken) {
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
