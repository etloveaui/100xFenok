#!/usr/bin/env node
/**
 * Data Transformer for Miyakojima Web App
 * Converts raw GPT-optimized data to web-compatible format
 */

const fs = require('fs').promises;
const path = require('path');

class DataTransformer {
    constructor() {
        this.categoryMapping = {
            '자연·전망': 'nature',
            '해변': 'beaches',
            '액티비티': 'activities',
            '음식점': 'restaurants',
            '문화': 'culture',
            '쇼핑': 'shopping',
            '숙박': 'accommodations'
        };

        this.webCategories = {
            'beaches': '해변',
            'activities': '액티비티',
            'restaurants': '음식점',
            'culture': '문화',
            'nature': '자연',
            'shopping': '쇼핑'
        };
    }

    /**
     * Transform raw POI data to web format
     */
    async transformPOIData(rawDataPath, outputPath) {
        try {
            console.log('🔄 Loading raw POI data...');
            const rawData = JSON.parse(await fs.readFile(rawDataPath, 'utf8'));

            console.log(`📊 Found ${rawData.length} POIs in raw data`);

            const transformedPOIs = [];
            let validPOIs = 0;

            for (let i = 0; i < rawData.length; i++) {
                const rawPOI = rawData[i];
                try {
                    const webPOI = this.transformSinglePOI(rawPOI, `poi_${String(i+1).padStart(3, '0')}`);
                    if (webPOI) {
                        transformedPOIs.push(webPOI);
                        validPOIs++;
                    }
                } catch (error) {
                    console.warn(`⚠️ Failed to transform POI ${rawPOI.id}: ${error.message}`);
                }
            }

            // Create web-compatible data structure
            const webData = {
                version: "4.0.0",
                lastUpdated: new Date().toISOString(),
                totalPOIs: validPOIs,
                categories: this.webCategories,
                source: "rawdata_transform",
                pois: transformedPOIs
            };

            console.log(`✅ Transformed ${validPOIs} POIs successfully`);

            // Write to output file
            await fs.writeFile(outputPath, JSON.stringify(webData, null, 2), 'utf8');
            console.log(`💾 Saved to ${outputPath}`);

            return {
                success: true,
                totalRaw: rawData.length,
                totalTransformed: validPOIs,
                outputFile: outputPath
            };

        } catch (error) {
            console.error('❌ Transform failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Transform single POI from raw to web format
     */
    transformSinglePOI(rawPOI, fallbackId = null) {
        // Determine web category
        const primaryCategory = rawPOI.category_primary || rawPOI.categories_all?.[0];
        let webCategory = 'activities'; // default

        for (const [korKey, engKey] of Object.entries(this.categoryMapping)) {
            if (primaryCategory?.includes(korKey)) {
                webCategory = engKey;
                break;
            }
        }

        // Build coordinates
        const coordinates = {};
        if (rawPOI.lat && rawPOI.lng) {
            coordinates.lat = parseFloat(rawPOI.lat);
            coordinates.lng = parseFloat(rawPOI.lng);
        } else if (rawPOI.lon) {
            coordinates.lat = parseFloat(rawPOI.lat);
            coordinates.lng = parseFloat(rawPOI.lon);
        }

        // Extract features/tags
        const features = [];
        if (rawPOI.categories_all) {
            features.push(...rawPOI.categories_all);
        }
        if (rawPOI.features) {
            features.push(...rawPOI.features);
        }

        // Build cost structure
        const cost = {};
        if (rawPOI.price_range || rawPOI.cost_info) {
            const priceInfo = rawPOI.price_range || rawPOI.cost_info;
            if (typeof priceInfo === 'string') {
                if (priceInfo.includes('무료') || priceInfo.includes('Free')) {
                    cost.min = 0;
                    cost.max = 0;
                    cost.currency = 'JPY';
                } else if (priceInfo.includes('JPY') || priceInfo.includes('¥')) {
                    // Extract numbers from price string
                    const numbers = priceInfo.match(/\d+/g);
                    if (numbers) {
                        cost.min = parseInt(numbers[0]);
                        cost.max = numbers.length > 1 ? parseInt(numbers[1]) : parseInt(numbers[0]);
                        cost.currency = 'JPY';
                    }
                }
            }
        }

        // Create web POI object
        const webPOI = {
            id: rawPOI.id || fallbackId || `poi_${Date.now()}`,
            name: rawPOI.name_ko || rawPOI.name_local || rawPOI.name || 'Unknown',
            nameEn: rawPOI.name_local || rawPOI.name_en || rawPOI.name_ko || 'Unknown',
            category: webCategory,
            description: rawPOI.description || rawPOI.summary || '',
            openHours: rawPOI.hours || rawPOI.opening_hours || '정보 없음',
            tips: rawPOI.tips || rawPOI.travel_tips || rawPOI.notes || '',
            accessibility: rawPOI.accessibility || '정보 없음'
        };

        // Add optional fields
        if (rawPOI.rating || rawPOI.review_rating) {
            webPOI.rating = parseFloat(rawPOI.rating || rawPOI.review_rating);
        }

        if (Object.keys(coordinates).length > 0) {
            webPOI.coordinates = coordinates;
        }

        if (Object.keys(cost).length > 0) {
            webPOI.cost = cost;
        }

        if (features.length > 0) {
            webPOI.features = [...new Set(features)]; // Remove duplicates
        }

        if (rawPOI.address_raw || rawPOI.address) {
            webPOI.address = rawPOI.address_raw || rawPOI.address;
        }

        if (rawPOI.phone || rawPOI.contact_phone) {
            webPOI.phone = rawPOI.phone || rawPOI.contact_phone;
        }

        if (rawPOI.website || rawPOI.url) {
            webPOI.website = rawPOI.website || rawPOI.url;
        }

        return webPOI;
    }

    /**
     * Transform other data files (budget, itinerary, etc.)
     */
    async transformOtherData(dataType, rawDataPath, outputPath) {
        try {
            const rawData = JSON.parse(await fs.readFile(rawDataPath, 'utf8'));

            let transformedData;
            switch (dataType) {
                case 'budget':
                    transformedData = this.transformBudgetData(rawData);
                    break;
                case 'itinerary':
                    transformedData = this.transformItineraryData(rawData);
                    break;
                default:
                    // For other files, just add metadata and pass through
                    transformedData = {
                        version: "1.0.0",
                        lastUpdated: new Date().toISOString(),
                        source: "rawdata_transform",
                        data: rawData
                    };
            }

            await fs.writeFile(outputPath, JSON.stringify(transformedData, null, 2), 'utf8');
            console.log(`✅ Transformed ${dataType} data to ${outputPath}`);

            return { success: true, outputFile: outputPath };

        } catch (error) {
            console.error(`❌ Failed to transform ${dataType} data:`, error.message);
            return { success: false, error: error.message };
        }
    }

    transformBudgetData(rawData) {
        return {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            source: "rawdata_transform",
            budget: rawData
        };
    }

    transformItineraryData(rawData) {
        return {
            version: "1.0.0",
            lastUpdated: new Date().toISOString(),
            source: "rawdata_transform",
            itinerary: rawData
        };
    }
}

// CLI Usage
if (require.main === module) {
    const transformer = new DataTransformer();

    const rawPOIPath = path.join(__dirname, 'docs', 'rawdata', 'data', 'miyakojima_pois.json');
    const outputPOIPath = path.join(__dirname, 'data', 'miyakojima_pois.json');

    console.log('🚀 Starting data transformation...');
    console.log(`📁 Input: ${rawPOIPath}`);
    console.log(`📁 Output: ${outputPOIPath}`);

    transformer.transformPOIData(rawPOIPath, outputPOIPath)
        .then(result => {
            if (result.success) {
                console.log('\n🎉 Data transformation completed successfully!');
                console.log(`📊 Raw POIs: ${result.totalRaw}`);
                console.log(`✅ Transformed POIs: ${result.totalTransformed}`);
                console.log(`📄 Output file: ${result.outputFile}`);
            } else {
                console.error('\n❌ Data transformation failed!');
                process.exit(1);
            }
        })
        .catch(error => {
            console.error('\n💥 Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = DataTransformer;