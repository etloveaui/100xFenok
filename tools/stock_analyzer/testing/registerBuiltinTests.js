(function () {
    if (!window.CollaborativeTestSuite) {
        console.warn('CollaborativeTestSuite not available. Built-in tests were not registered.');
        return;
    }

    const suite = new window.CollaborativeTestSuite({
        reporter: window.DefaultTestReporter
    });

    window.collaborativeTestSuite = suite;
    window.runCollaborativeTests = (context) => suite.runAllTests(context);

    const ensureDataLoaded = () => {
        if (!Array.isArray(window.allData) || window.allData.length === 0) {
            throw new Error('allData not loaded');
        }
        return window.allData;
    };

    // DeepCompare tests
    suite.registerAgentTests('codex', 'DeepCompare', [
        {
            name: 'DeepCompare instance available',
            handler: () => {
                if (!window.deepCompare) {
                    throw new Error('window.deepCompare is not defined');
                }
            }
        },
        {
            name: 'Bubble dataset produces meta info',
            handler: () => {
                const data = ensureDataLoaded();
                const entity = {
                    type: 'company',
                    id: data[0].Ticker || 'sample',
                    name: data[0].corpName || 'sample company',
                    raw: data[0]
                };
                const dataset = window.deepCompare.engine.buildBubbleDataset([entity]);
                if (!Array.isArray(dataset) || dataset.length === 0) {
                    throw new Error('Bubble dataset empty');
                }
                const first = dataset[0];
                if (!first.meta || typeof first.meta.id === 'undefined') {
                    throw new Error('Meta information missing');
                }
            }
        },
        {
            name: 'refreshDataSource collects available items',
            handler: () => {
                const before = window.deepCompare.availableItems?.length || 0;
                window.deepCompare.refreshDataSource();
                const after = window.deepCompare.availableItems?.length || 0;
                if (after === 0) {
                    throw new Error('DeepCompare available items not populated');
                }
                if (before === after && before === 0) {
                    throw new Error('DeepCompare refresh did not load items');
                }
            }
        }
    ]);

    // PortfolioBuilder tests
    suite.registerAgentTests('codex', 'PortfolioBuilder', [
        {
            name: 'PortfolioBuilder instance available',
            handler: () => {
                if (!window.portfolioBuilder) {
                    throw new Error('window.portfolioBuilder is not defined');
                }
            }
        },
        {
            name: 'collectData mirrors allData length',
            handler: () => {
                const data = ensureDataLoaded();
                window.portfolioBuilder.collectData();
                if (!window.portfolioBuilder.allData || window.portfolioBuilder.allData.length !== data.length) {
                    throw new Error('PortfolioBuilder collectData mismatch');
                }
            }
        },
        {
            name: 'runOptimization returns result',
            handler: async () => {
                const data = ensureDataLoaded();
                const builder = window.portfolioBuilder;
                const originalHoldings = builder.portfolio.getHoldings();

                builder.portfolio.clear();
                builder.portfolio.upsertHolding(data[0]);
                builder.portfolio.upsertHolding(data[1]);
                const result = await builder.runOptimization();
                if (!result || !Array.isArray(result.holdings) || result.holdings.length === 0) {
                    throw new Error('Optimization returned empty result');
                }

                builder.portfolio.clear();
                originalHoldings.forEach(item => {
                    builder.portfolio.upsertHolding(item.company, item.weight);
                });
                if (typeof builder.refreshHoldings === 'function') {
                    builder.refreshHoldings();
                }
            }
        }
    ]);

    // Integration tests
    suite.registerIntegrationTest('DeepCompare ↔ PortfolioBuilder shares dataset', async () => {
        const data = ensureDataLoaded();
        if (!window.deepCompare || !window.portfolioBuilder) {
            throw new Error('Modules not ready');
        }
        window.deepCompare.refreshDataSource();
        window.portfolioBuilder.collectData();
        if (window.deepCompare.availableItems.length === 0) {
            throw new Error('DeepCompare available items empty after refresh');
        }
        if (window.portfolioBuilder.allData.length !== data.length) {
            throw new Error('PortfolioBuilder data length mismatch');
        }
    }, { severity: 'high' });

    console.log('✅ Built-in collaborative tests 등록 완료');
})();
