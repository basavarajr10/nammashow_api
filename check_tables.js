const db = require('./config/db');

async function checkCols() {
    try {
        console.log('--- FOOD TABLE COLUMNS ---');
        const cols1 = await db.query('DESCRIBE food_and_beverage_managements');
        console.log(JSON.stringify(cols1, null, 2));

        console.log('\n--- TRANSLATION TABLE COLUMNS ---');
        const cols2 = await db.query('DESCRIBE food_and_beverage_management_translations');
        console.log(JSON.stringify(cols2, null, 2));

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

checkCols();