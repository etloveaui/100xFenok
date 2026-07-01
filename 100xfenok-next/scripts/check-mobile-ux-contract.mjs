import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MOBILE_UX_STRICT !== "0";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";
const routes = (process.env.QA_MOBILE_UX_ROUTES || "/,/?v5=1,/workbench,/screener,/sectors,/portfolio,/stock/NVDA,/stock/NVDA?tab=financials,/stock/NVDA?tab=ownership,/stock/NVDA?tab=estimates,/superinvestors?tab=insights")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 375, height: 812 },
};

const requestedViewports = (process.env.QA_MOBILE_UX_VIEWPORTS || "mobile,narrow")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const viewports = requestedViewports
  .map((name) => ({ name, viewport: viewportCatalog[name] }))
  .filter((entry) => entry.viewport);

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

async function installQaPortfolio(context) {
  await context.addInitScript(() => {
    const doc = {
      version: 1,
      updated_at: "2026-06-24T00:00:00.000Z",
      portfolios: [
        {
          id: "qa-mobile",
          name: "QA 모바일",
          currency: "USD",
          cash: 1250,
          holdings: [
            { ticker: "NVDA", shares: 3, avg_cost: 96.1 },
            { ticker: "AAPL", shares: 5, avg_cost: 198.4 },
          ],
        },
      ],
    };
    window.localStorage.setItem("fenok.portfolio.v1", JSON.stringify(doc));
  });
}

async function collectRouteChecks(page, route) {
  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );

    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    const tabbar = document.querySelector(".fnk-shell .tabbar");
    if (tabbar) {
      const tabs = Array.from(tabbar.querySelectorAll(".tab"))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (tabs.length !== 5) {
        failures.push({ check: "mobile-tab-count", detail: `visible tabs=${tabs.length}` });
      }
      const actualTabs = tabs.map((tab) => {
        const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
        const label = (tab.textContent || "").replace(/\s+/g, " ").trim();
        const href = tab instanceof HTMLAnchorElement ? normalizePath(new URL(tab.href, window.location.origin).pathname) : null;
        return { label, path: href };
      });
      const expected = [
        { label: "홈", path: "/" },
        { label: "시장", path: "/market-valuation" },
        { label: "스크리너", path: "/screener" },
        { label: "포트폴리오", path: "/portfolio" },
        { label: "더보기", path: null },
      ];
      const tabContractOk =
        actualTabs.length === expected.length &&
        expected.every((tab, index) => actualTabs[index]?.label === tab.label && actualTabs[index]?.path === tab.path);
      if (!tabContractOk) {
        failures.push({
          check: "mobile-tab-primary-ia",
          detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expected)}`,
        });
      }
      tabs.forEach((tab, index) => {
        const style = window.getComputedStyle(tab);
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const rect = tab.getBoundingClientRect();
        if (fontSize < 11) {
          failures.push({ check: "mobile-tab-font", detail: `tab ${index} font=${fontSize}` });
        }
        if (rect.height < 44) {
          failures.push({ check: "mobile-tab-target", detail: `tab ${index} height=${rect.height}` });
        }
      });
    }

    if (currentRoute === "/" || currentRoute.startsWith("/?")) {
      const homeSearch = document.querySelector("[data-home-search-first]");
      const homeSearchInput = homeSearch?.querySelector('[role="combobox"]');
      const homeSearchRect = homeSearchInput?.getBoundingClientRect();
      const homeSearchVisible = Boolean(
        homeSearchRect &&
        homeSearchRect.width > 0 &&
        homeSearchRect.height >= 32 &&
        homeSearchRect.top >= 0 &&
        homeSearchRect.top < window.innerHeight * 0.45,
      );
      if (!homeSearchVisible) {
        failures.push({
          check: "home-search-first-visible",
          detail: homeSearchRect
            ? `top=${homeSearchRect.top} height=${homeSearchRect.height}`
            : "missing [data-home-search-first] combobox",
        });
      }
      const featureTiles = Array.from(document.querySelectorAll("[data-home-feature-tile]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
        });
      if (featureTiles.length < 4 || featureTiles.length > 6) {
        failures.push({ check: "home-feature-tile-count", detail: `visible tiles=${featureTiles.length}` });
      }
    }

    if (currentRoute.startsWith("/workbench")) {
      const gateway = document.querySelector("[data-workbench-gateway]");
      const ownerLinks = Array.from(document.querySelectorAll("[data-workbench-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

      if (!gateway || gateway.getBoundingClientRect().height <= 0) {
        failures.push({ check: "workbench-gateway-visible", detail: "missing visible workbench gateway" });
      }

      const expectedLinks = [
        "/market-valuation",
        "/sectors",
        "/etfs",
        "/screener",
        "/superinvestors",
        "/portfolio",
        "/macro-chart",
      ];
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((href, index) => actualLinks[index] === href)
      ) {
        failures.push({
          check: "workbench-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }

      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "workbench-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });
    }

    if (currentRoute.startsWith("/screener")) {
      const visibleCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      visibleCheckboxes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) {
          failures.push({
            check: "screener-checkbox-size",
            detail: `checkbox ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });

      const mobileExpandButtons = Array.from(document.querySelectorAll('[aria-controls^="screener-mobile-detail"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (mobileExpandButtons.length === 0) {
        failures.push({ check: "screener-mobile-expand-present", detail: "no visible mobile expand button" });
      }
      mobileExpandButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({
            check: "screener-expand-target",
            detail: `expand ${index} height=${Math.round(rect.height)}`,
          });
        }
      });

      const densityControl = document.querySelector("[data-screener-density-control]");
      const densityButtons = densityControl
        ? Array.from(densityControl.querySelectorAll('button[aria-pressed]'))
          .filter((node) => node.getBoundingClientRect().width > 0)
        : [];
      if (densityButtons.length !== 3) {
        failures.push({ check: "screener-density-control", detail: `buttons=${densityButtons.length}` });
      }
    }

    if (currentRoute.startsWith("/sectors")) {
      const viewSwitch = document.querySelector("[data-sector-view-switch]");
      const viewTabs = Array.from(document.querySelectorAll("[data-sector-view-tab]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      if (!viewSwitch || viewSwitch.getBoundingClientRect().height <= 0) {
        failures.push({ check: "sector-view-switch-visible", detail: "missing visible sector view switch" });
      }

      const expectedTabs = ["heatmap", "etf", "valuation", "guru"];
      const actualTabs = viewTabs.map((node) => node.getAttribute("data-sector-view-tab"));
      if (
        viewTabs.length !== expectedTabs.length ||
        !expectedTabs.every((tab, index) => actualTabs[index] === tab)
      ) {
        failures.push({
          check: "sector-view-switch-tabs",
          detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expectedTabs)}`,
        });
      }
      viewTabs.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "sector-view-switch-target", detail: `tab ${index} height=${Math.round(rect.height)}` });
        }
      });

      const heatmapPanel = document.querySelector('[data-sector-panel="heatmap"]');
      if (!heatmapPanel || heatmapPanel.getBoundingClientRect().height <= 0) {
        failures.push({ check: "sector-heatmap-default-visible", detail: "default heatmap panel not visible" });
      }
    }

    if (currentRoute.startsWith("/portfolio")) {
      const editButtons = Array.from(document.querySelectorAll('button[aria-label$="수정 입력"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      const deleteButtons = Array.from(document.querySelectorAll('button[aria-label$="삭제"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (editButtons.length === 0) {
        failures.push({ check: "portfolio-edit-present", detail: "no visible edit action" });
      }
      if (deleteButtons.length === 0) {
        failures.push({ check: "portfolio-delete-present", detail: "no visible delete action" });
      }
      [...editButtons, ...deleteButtons].forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 36 || rect.height < 36) {
          failures.push({
            check: "portfolio-action-target",
            detail: `button ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });
      const connectionActions = Array.from(document.querySelectorAll('[data-portfolio-touch-action]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (connectionActions.length === 0) {
        failures.push({ check: "portfolio-connection-action-present", detail: "no visible connection action" });
      }
      connectionActions.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 36 || rect.height < 36) {
          failures.push({
            check: "portfolio-connection-action-target",
            detail: `action ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });
      const managementSections = [
        { key: "holdings", node: document.querySelector('[data-portfolio-section="holdings"]') },
        { key: "add-holding", node: document.querySelector('[data-portfolio-section="add-holding"]') },
        { key: "cash", node: document.querySelector('[data-portfolio-section="cash"]') },
      ];
      const connectionSection = document.querySelector('[data-portfolio-section="connections"]');
      if (!connectionSection || managementSections.some((entry) => !entry.node)) {
        failures.push({
          check: "portfolio-management-sections-present",
          detail: JSON.stringify({
            connection: Boolean(connectionSection),
            management: managementSections.map((entry) => [entry.key, Boolean(entry.node)]),
          }),
        });
      } else {
        const connectionTop = connectionSection.getBoundingClientRect().top;
        const lateSection = managementSections.find((entry) => entry.node.getBoundingClientRect().top > connectionTop);
        if (lateSection) {
          failures.push({
            check: "portfolio-management-before-connections",
            detail: `${lateSection.key} starts after connection service`,
          });
        }
      }
    }

    if (currentRoute.startsWith("/stock/")) {
      const stockRouteParams = new URL(currentRoute, window.location.origin).searchParams;
      const stockTab = stockRouteParams.get("tab") || "overview";
      const tabs = document.querySelector(".stock-tabs");
      if (tabs) {
        const overflowed = tabs.scrollWidth > tabs.clientWidth + 1;
        if (overflowed && !tabs.classList.contains("can-scroll")) {
          failures.push({
            check: "stock-tabs-scroll-affordance",
            detail: `scrollWidth=${tabs.scrollWidth} clientWidth=${tabs.clientWidth}`,
          });
        }
        const stockTabLabels = Array.from(tabs.querySelectorAll('[role="tab"]'))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim());
        const expectedStockTabOrder = ["요약", "밸류", "추정치", "재무", "보유기관", "공시"];
        if (stockTabLabels.includes("요약") && stockTabLabels.includes("공시")) {
          const actualPrimaryOrder = stockTabLabels.filter((label) => expectedStockTabOrder.includes(label));
          const orderOk =
            actualPrimaryOrder.length === expectedStockTabOrder.length &&
            expectedStockTabOrder.every((label, index) => actualPrimaryOrder[index] === label);
          if (!orderOk) {
            failures.push({
              check: "stock-pro-tab-order",
              detail: `actual=${JSON.stringify(stockTabLabels)} expected=${JSON.stringify(expectedStockTabOrder)}`,
            });
          }
        }
      }
      if (stockTab === "overview") {
        const summaryModules = Array.from(document.querySelectorAll("[data-stock-summary-module]"))
          .map((node) => ({
            key: node.getAttribute("data-stock-summary-module"),
            rect: node.getBoundingClientRect(),
          }))
          .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
        const summaryScore = summaryModules.find((entry) => entry.key === "summary-score");
        const valuationBand = summaryModules.find((entry) => entry.key === "valuation-band");
        const threeSecondSummary = summaryModules.find((entry) => entry.key === "three-second-summary");
        if (!summaryScore || !valuationBand) {
          failures.push({
            check: "stock-summary-valuation-modules-present",
            detail: `modules=${JSON.stringify(summaryModules.map((entry) => entry.key))}`,
          });
        } else if (summaryScore.rect.top > valuationBand.rect.top + 1) {
          failures.push({
            check: "stock-summary-before-valuation",
            detail: `summaryTop=${summaryScore.rect.top} valuationTop=${valuationBand.rect.top}`,
          });
        }
        if (summaryScore && threeSecondSummary && summaryScore.rect.top > threeSecondSummary.rect.top + 1) {
          failures.push({
            check: "stock-summary-score-first",
            detail: `summaryTop=${summaryScore.rect.top} threeSecondTop=${threeSecondSummary.rect.top}`,
          });
        }
        if (valuationBand) {
          const valuationTrack = valuationBand.rect.height > 0
            ? document.querySelector("[data-stock-valuation-band-track]")
            : null;
          const valuationVerdict = document.querySelector("[data-stock-valuation-verdict]");
          const valuationZones = Array.from(document.querySelectorAll("[data-stock-valuation-zone]"))
            .map((node) => node.getAttribute("data-stock-valuation-zone"));
          const expectedZones = ["deep-discount", "discount", "neutral", "premium", "overheated"];
          if (!valuationTrack || valuationTrack.getBoundingClientRect().height <= 0) {
            failures.push({ check: "stock-valuation-band-track-visible", detail: "missing visible graduated valuation track" });
          }
          if (!valuationVerdict || !(valuationVerdict.textContent || "").trim()) {
            failures.push({ check: "stock-valuation-verdict-present", detail: "missing plain-language valuation verdict" });
          }
          if (
            valuationZones.length !== expectedZones.length ||
            !expectedZones.every((zone, index) => valuationZones[index] === zone)
          ) {
            failures.push({
              check: "stock-valuation-graduated-zones",
              detail: `actual=${JSON.stringify(valuationZones)} expected=${JSON.stringify(expectedZones)}`,
            });
          }
        }
      }
      if (stockTab === "ownership") {
        const diff = document.querySelector('[data-smart-money-section="diff"]');
        const holdings = document.querySelector('[data-smart-money-section="holdings"]');
        const asOf = document.querySelector("[data-smart-money-asof]");
        if (!diff || !holdings || !asOf) {
          failures.push({
            check: "stock-smart-money-diff-modules-present",
            detail: JSON.stringify({ diff: Boolean(diff), holdings: Boolean(holdings), asOf: Boolean(asOf) }),
          });
        } else if (diff.getBoundingClientRect().top > holdings.getBoundingClientRect().top + 1) {
          failures.push({
            check: "stock-smart-money-diff-before-holdings",
            detail: `diffTop=${diff.getBoundingClientRect().top} holdingsTop=${holdings.getBoundingClientRect().top}`,
          });
        }
      }
      if (stockTab === "estimates") {
        const disclosure = document.querySelector("[data-stock-estimate-disclosure]");
        if (!disclosure || disclosure.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimate-disclosure-present", detail: "missing visible estimate source/EPS basis disclosure" });
        }
        const consensusSummary = document.querySelector("[data-stock-estimates-consensus-summary]");
        const consensusCards = Array.from(document.querySelectorAll("[data-stock-estimates-consensus-card]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const granularityControl = document.querySelector("[data-stock-estimates-granularity-control]");
        const granularityButtons = Array.from(document.querySelectorAll("[data-stock-estimates-granularity]"))
          .filter((node) => node.getBoundingClientRect().width > 0);
        const annualPanel = document.querySelector("[data-stock-estimates-annual-panel]");
        const detailTable = document.querySelector("[data-stock-estimates-detail-table]");
        if (!consensusSummary || consensusSummary.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimates-consensus-summary-visible", detail: "missing visible consensus summary" });
        }
        if (consensusCards.length < 4) {
          failures.push({ check: "stock-estimates-consensus-card-count", detail: `cards=${consensusCards.length}` });
        }
        const expectedGranularity = ["annual", "quarterly"];
        const actualGranularity = granularityButtons.map((node) => node.getAttribute("data-stock-estimates-granularity"));
        if (
          !granularityControl ||
          granularityButtons.length !== expectedGranularity.length ||
          !expectedGranularity.every((key, index) => actualGranularity[index] === key)
        ) {
          failures.push({
            check: "stock-estimates-granularity-control",
            detail: `actual=${JSON.stringify(actualGranularity)} expected=${JSON.stringify(expectedGranularity)}`,
          });
        }
        if (consensusSummary && detailTable) {
          const summaryTop = consensusSummary.getBoundingClientRect().top;
          const detailTop = detailTable.getBoundingClientRect().top;
          if (summaryTop > detailTop + 1) {
            failures.push({
              check: "stock-estimates-consensus-before-detail",
              detail: `summaryTop=${summaryTop} detailTop=${detailTop}`,
            });
          }
        }
        if (!annualPanel || annualPanel.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimates-annual-panel-visible", detail: "missing visible annual estimates panel" });
        }
      }
      if (stockTab === "financials" || stockTab === "estimates") {
        const financialTables = Array.from(document.querySelectorAll("[data-stock-financial-table]"))
          .filter((table) => table.getBoundingClientRect().width > 0 && table.getBoundingClientRect().height > 0);
        if (financialTables.length === 0) {
          failures.push({ check: "stock-financial-table-present", detail: `tab=${stockTab}` });
        }
        financialTables.forEach((table, tableIndex) => {
          const firstHeader = table.querySelector("thead th:first-child");
          const firstCell = table.querySelector("tbody tr td:first-child");
          [
            { kind: "header", node: firstHeader },
            { kind: "cell", node: firstCell },
          ].forEach((entry) => {
            if (!entry.node) {
              failures.push({ check: "stock-financial-sticky-first-column-node", detail: `table=${tableIndex} missing=${entry.kind}` });
              return;
            }
            const style = window.getComputedStyle(entry.node);
            const left = Number.parseFloat(style.left || "999");
            if (style.position !== "sticky" || Math.abs(left) > 1) {
              failures.push({
                check: "stock-financial-sticky-first-column",
                detail: `table=${tableIndex} ${entry.kind} position=${style.position} left=${style.left}`,
              });
            }
          });
        });
      }
      if (stockTab === "financials") {
        const rowChartButtons = Array.from(document.querySelectorAll("[data-stock-financial-row-chart-button]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (rowChartButtons.length < 4) {
          failures.push({ check: "stock-financial-row-chart-buttons", detail: `visible buttons=${rowChartButtons.length}` });
        }
        rowChartButtons.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 36 || rect.height < 28) {
            failures.push({
              check: "stock-financial-row-chart-target",
              detail: `button ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
            });
          }
        });
      }
    }

    if (currentRoute.startsWith("/superinvestors")) {
      const regions = Array.from(document.querySelectorAll('.scroll-hint-x[role="region"][tabindex="0"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (regions.length === 0) {
        failures.push({ check: "superinvestors-scroll-region", detail: "no visible scroll-hint region" });
      }
      if (currentRoute.includes("tab=insights") && regions.length < 5) {
        failures.push({ check: "superinvestors-insights-scroll-regions", detail: `visible regions=${regions.length}` });
      }
      if (currentRoute.includes("tab=insights")) {
        const heatmap = document.querySelector("[data-superinvestor-accumulation-heatmap]");
        const tiles = Array.from(document.querySelectorAll("[data-superinvestor-accumulation-tile]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!heatmap || heatmap.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-accumulation-heatmap-visible", detail: "missing visible accumulation heat-map" });
        }
        if (tiles.length < 6) {
          failures.push({ check: "superinvestors-accumulation-heatmap-tiles", detail: `visible tiles=${tiles.length}` });
        }
        const investorCounts = tiles
          .map((node) => Number.parseInt(node.getAttribute("data-superinvestor-accumulation-investors") || "", 10))
          .filter(Number.isFinite);
        const sortedDescending = investorCounts.every((value, index) => index === 0 || investorCounts[index - 1] >= value);
        if (investorCounts.length !== tiles.length || !sortedDescending) {
          failures.push({
            check: "superinvestors-accumulation-heatmap-sort",
            detail: `investors=${JSON.stringify(investorCounts)}`,
          });
        }
      }
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectScreenerExpandedChecks(page, route) {
  const button = page.locator('[aria-controls^="screener-mobile-detail"]').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "screener-expanded-click-target", detail: "no mobile detail button to click" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const detail = document.querySelector('[id^="screener-mobile-detail"]');

    if (!detail || detail.getBoundingClientRect().height <= 0) {
      failures.push({ check: "screener-expanded-detail-visible", detail: "expanded detail panel not visible" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "screener-expanded-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectStockFinancialChartChecks(page, route) {
  const button = page.locator("[data-stock-financial-row-chart-button]").first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-financial-row-chart-click", detail: "no financial row chart button to click" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(250);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const panel = document.querySelector("[data-stock-financial-row-chart-panel]");

    if (!panel || panel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-financial-row-chart-panel-visible", detail: "expanded row chart panel not visible" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-financial-row-chart-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectStockEstimatesToggleChecks(page, route) {
  const button = page.locator('[data-stock-estimates-granularity="quarterly"]').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-estimates-quarterly-toggle-click", detail: "no quarterly estimates toggle" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(250);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const panel = document.querySelector("[data-stock-estimates-quarterly-panel]");
    const quarterlyButton = document.querySelector('[data-stock-estimates-granularity="quarterly"]');

    if (!panel || panel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-estimates-quarterly-panel-visible", detail: "quarterly estimates panel not visible after click" });
    }
    if (quarterlyButton?.getAttribute("aria-pressed") !== "true") {
      failures.push({ check: "stock-estimates-quarterly-toggle-state", detail: "quarterly toggle not pressed after click" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-estimates-quarterly-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

if (routes.length === 0) {
  throw new Error("No QA_MOBILE_UX_ROUTES configured.");
}

if (viewports.length === 0) {
  throw new Error("No valid QA_MOBILE_UX_VIEWPORTS configured.");
}

const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
});
const results = [];

try {
  for (const { name, viewport } of viewports) {
    const context = await browser.newContext({ viewport });
    await installQaPortfolio(context);
    const page = await context.newPage();

    for (const route of routes) {
      const result = {
        viewport: name,
        route,
        status: null,
        failures: [],
      };

      try {
        const response = await page.goto(routeUrl(route), {
          waitUntil: "networkidle",
          timeout: 45000,
        });
        result.status = response ? response.status() : null;
        await page.waitForTimeout(250);
        const checks = await collectRouteChecks(page, route);
        result.failures = checks.failures;
        result.viewportWidth = checks.viewportWidth;
        result.scrollWidth = checks.scrollWidth;
        if (route.startsWith("/screener")) {
          const expandedChecks = await collectScreenerExpandedChecks(page, route);
          result.failures.push(...expandedChecks.failures);
          result.expandedScrollWidth = expandedChecks.scrollWidth;
        }
        if (route.startsWith("/stock/") && route.includes("tab=financials")) {
          const financialChartChecks = await collectStockFinancialChartChecks(page, route);
          result.failures.push(...financialChartChecks.failures);
          result.financialChartScrollWidth = financialChartChecks.scrollWidth;
        }
        if (route.startsWith("/stock/") && route.includes("tab=estimates")) {
          const estimatesToggleChecks = await collectStockEstimatesToggleChecks(page, route);
          result.failures.push(...estimatesToggleChecks.failures);
          result.estimatesToggleScrollWidth = estimatesToggleChecks.scrollWidth;
        }
      } catch (error) {
        result.failures = [{ check: "navigation", detail: String(error) }];
      }

      results.push(result);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const failing = results.filter((result) => result.failures.length > 0);
const summary = {
  total: results.length,
  failing: failing.length,
  strictMode,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (strictMode && failing.length > 0) {
  process.exit(1);
}
