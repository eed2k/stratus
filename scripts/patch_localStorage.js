// Patch script to fix insertWeatherDataBatch in compiled JS
// This fixes the bug where batch insert was using SQLite instead of PostgreSQL
const fs = require('fs');
const path = '/app/dist/server/localStorage.js';
let content = fs.readFileSync(path, 'utf8');

// Check if already patched
if (content.includes('usePostgres') && content.includes('Batch inserted')) {
    console.log('ALREADY PATCHED: Function already uses usePostgres check');
    process.exit(0);
}

// Find the old function using a unique marker
const marker = 'db_1.default.insertWeatherData(dbRecords);\n            return records.length;';
if (!content.includes(marker)) {
    console.log('ERROR: Could not find the buggy pattern to replace');
    console.log('Looking for: db_1.default.insertWeatherData(dbRecords); return records.length;');
    process.exit(1);
}

// Replace the old function body between the function signature and createStationLog
const oldFunc = [
    '    async insertWeatherDataBatch(records) {',
    '        if (records.length === 0)',
    '            return 0;',
    '        try {',
    '            const dbRecords = records.map(data => ({',
    '                station_id: data.stationId,',
    '                table_name: data.tableName || \'Table1\',',
    '                record_number: data.recordNumber,',
    '                timestamp: data.timestamp.toISOString(),',
    '                data: JSON.stringify(data.data)',
    '            }));',
    '            db_1.default.insertWeatherData(dbRecords);',
    '            return records.length;',
    '        }',
    '        catch (err) {',
    '            // If batch fails due to duplicates, fall back to individual inserts',
    '            if (err.message?.includes(\'UNIQUE constraint\')) {',
    '                let inserted = 0;',
    '                for (const data of records) {',
    '                    try {',
    '                        await this.insertWeatherData(data);',
    '                        inserted++;',
    '                    }',
    '                    catch {',
    '                        // Skip duplicates',
    '                    }',
    '                }',
    '                return inserted;',
    '            }',
    '            throw err;',
    '        }',
    '    }'
].join('\n');

const newFunc = [
    '    async insertWeatherDataBatch(records) {',
    '        if (records.length === 0)',
    '            return 0;',
    '        try {',
    '            if (usePostgres) {',
    '                const pgRecords = records.map(data => ({',
    '                    stationId: data.stationId,',
    '                    tableName: data.tableName || \'Table1\',',
    '                    recordNumber: data.recordNumber,',
    '                    timestamp: data.timestamp.toISOString(),',
    '                    data: data.data',
    '                }));',
    '                const inserted = await postgres.insertWeatherData(pgRecords);',
    '                storageLog.info(\'Batch inserted \' + inserted + \' records to PostgreSQL\');',
    '                return inserted;',
    '            }',
    '            else {',
    '                const dbRecords = records.map(data => ({',
    '                    station_id: data.stationId,',
    '                    table_name: data.tableName || \'Table1\',',
    '                    record_number: data.recordNumber,',
    '                    timestamp: data.timestamp.toISOString(),',
    '                    data: JSON.stringify(data.data)',
    '                }));',
    '                db_1.default.insertWeatherData(dbRecords);',
    '                return records.length;',
    '            }',
    '        }',
    '        catch (err) {',
    '            if (err.message?.includes(\'UNIQUE constraint\') || err.message?.includes(\'duplicate key\')) {',
    '                storageLog.warn(\'Batch insert failed with duplicates, falling back to individual inserts\');',
    '                let inserted = 0;',
    '                for (const data of records) {',
    '                    try {',
    '                        await this.insertWeatherData(data);',
    '                        inserted++;',
    '                    }',
    '                    catch {',
    '                        // Skip duplicates',
    '                    }',
    '                }',
    '                return inserted;',
    '            }',
    '            throw err;',
    '        }',
    '    }'
].join('\n');

if (content.includes(oldFunc)) {
    content = content.replace(oldFunc, newFunc);
    fs.writeFileSync(path, content);
    console.log('SUCCESS: Function patched successfully!');
    
    // Verify
    if (content.includes('usePostgres') && content.includes('postgres.insertWeatherData(pgRecords)')) {
        console.log('VERIFIED: Patch contains PostgreSQL batch insert');
    }
} else {
    console.log('ERROR: Exact old function text not found - may have whitespace differences');
    // Try a simpler replacement approach
    const simpleOld = 'db_1.default.insertWeatherData(dbRecords);\n            return records.length;';
    const simpleNew = [
        'if (usePostgres) {',
        '                const pgRecords = records.map(data => ({',
        '                    stationId: data.stationId,',
        '                    tableName: data.tableName || \'Table1\',',
        '                    recordNumber: data.recordNumber,',
        '                    timestamp: data.timestamp.toISOString(),',
        '                    data: data.data',
        '                }));',
        '                const inserted = await postgres.insertWeatherData(pgRecords);',
        '                storageLog.info(\'Batch inserted \' + inserted + \' records to PostgreSQL\');',
        '                return inserted;',
        '            }',
        '            else {',
        '                db_1.default.insertWeatherData(dbRecords);',
        '                return records.length;',
        '            }'
    ].join('\n            ');
    
    if (content.includes(simpleOld)) {
        content = content.replace(simpleOld, simpleNew);
        // Also fix the catch clause to handle duplicate key
        content = content.replace(
            "if (err.message?.includes('UNIQUE constraint'))",
            "if (err.message?.includes('UNIQUE constraint') || err.message?.includes('duplicate key'))"
        );
        fs.writeFileSync(path, content);
        console.log('SUCCESS: Applied simplified patch');
    } else {
        console.log('ERROR: Could not apply any patch');
    }
}
