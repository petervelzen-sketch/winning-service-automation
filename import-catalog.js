// ============================================
// WINNING APPLIANCES - CATALOG IMPORT SCRIPT
// ============================================
// Run this script to populate the product_catalog table
// Usage: node import-catalog.js

const mysql = require('mysql2/promise');

// Product type mapping from categories
function extractProductType(category, description) {
  const categoryUpper = category.toUpperCase();
  const descUpper = description.toUpperCase();
  
  // Map categories to product types
  if (categoryUpper.includes('DISHWASHER')) return 'Dishwasher';
  if (categoryUpper.includes('OVEN') || categoryUpper.includes('STOVE')) return 'Oven';
  if (categoryUpper.includes('COOKTOP')) return 'Cooktop';
  if (categoryUpper.includes('REFRIGERATOR') || categoryUpper.includes('FREEZER')) return 'Refrigerator';
  if (categoryUpper.includes('RANGEHOOD')) return 'Rangehood';
  if (categoryUpper.includes('MICROWAVE')) return 'Microwave';
  if (categoryUpper.includes('WASHER') || categoryUpper.includes('DRYER')) return 'Washing Machine';
  if (categoryUpper.includes('WINE')) return 'Wine Cabinet';
  if (categoryUpper.includes('COOKTOP')) return 'Cooktop';
  
  // Check description as fallback
  if (descUpper.includes('DISHWASH')) return 'Dishwasher';
  if (descUpper.includes('OVEN')) return 'Oven';
  if (descUpper.includes('COOKTOP')) return 'Cooktop';
  if (descUpper.includes('FRIDGE') || descUpper.includes('FREEZE')) return 'Refrigerator';
  if (descUpper.includes('RANGEHOOD') || descUpper.includes('RH ')) return 'Rangehood';
  if (descUpper.includes('MICROWAVE') || descUpper.includes('MW ')) return 'Microwave';
  if (descUpper.includes('WASH') || descUpper.includes('DRY')) return 'Washing Machine';
  
  return 'Appliance'; // Default
}

// Parse the catalog data (paste your full catalog here)
const CATALOG_DATA = `MISSONI	HOME ACCESSORIES	8.05315E+12	MAREA 100 HAND TOWEL 70X40	Active
MISSONI	HOME ACCESSORIES	8.05128E+12	GIACOMO 165 HANDTOWEL 40X70	Active
BOSCH	DISHWASHERS	SMV6HCX01A	BSH FULLY INT DW 15 P/S	Active
BOSCH	DISHWASHERS	SMU6HCS01A	BSH SERIE 6 UB DW HOMECONNECT	Active
NEFF	OVENS	S185HCX01A	NEFF N50 FULL INT DW 60CM	Active
ZIP	WATER TREATMENT	91295	ZIP HYDROTAP SPARKLING CO2 KIT	Active
[... PASTE YOUR FULL CATALOG DATA HERE ...]`;

async function importCatalog() {
  let connection;
  
  try {
    console.log('🔄 Starting catalog import...\n');
    
    // Connect to Railway MySQL
    connection = await mysql.createConnection({
      host: process.env.MYSQLHOST,
      port: process.env.MYSQLPORT || 3306,
      user: process.env.MYSQLUSER,
      password: process.env.MYSQLPASSWORD,
      database: process.env.MYSQLDATABASE
    });
    
    console.log('✅ Connected to MySQL database\n');
    
    // Create table if it doesn't exist
    console.log('📋 Creating product_catalog table...');
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS product_catalog (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(100) NOT NULL,
        manufacturer VARCHAR(100) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        product_type VARCHAR(100),
        status VARCHAR(20) DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        
        UNIQUE KEY unique_sku (sku),
        INDEX idx_manufacturer (manufacturer),
        INDEX idx_category (category),
        INDEX idx_product_type (product_type),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Table created/verified\n');
    
    // Parse catalog data
    console.log('📊 Parsing catalog data...');
    const lines = CATALOG_DATA.trim().split('\n');
    const records = [];
    
    for (const line of lines) {
      const fields = line.split('\t');
      if (fields.length >= 4) {
        const manufacturer = fields[0].trim();
        const category = fields[1].trim();
        const sku = fields[2].trim();
        const description = fields[3].trim();
        const status = fields[4] ? fields[4].trim() : 'Active';
        
        // Skip empty manufacturers or SKUs
        if (!manufacturer || !sku) continue;
        
        // Extract product type
        const product_type = extractProductType(category, description);
        
        records.push({
          manufacturer,
          category,
          sku,
          description,
          product_type,
          status
        });
      }
    }
    
    console.log(`✅ Parsed ${records.length} products\n`);
    
    // Import in batches
    console.log('💾 Importing records to database...');
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    const batchSize = 100;
    
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      
      for (const record of batch) {
        try {
          // Try to insert, update on duplicate key
          const [result] = await connection.execute(`
            INSERT INTO product_catalog 
              (manufacturer, category, sku, description, product_type, status)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              manufacturer = VALUES(manufacturer),
              category = VALUES(category),
              description = VALUES(description),
              product_type = VALUES(product_type),
              status = VALUES(status),
              updated_at = CURRENT_TIMESTAMP
          `, [
            record.manufacturer,
            record.category,
            record.sku,
            record.description,
            record.product_type,
            record.status
          ]);
          
          if (result.affectedRows === 1) {
            imported++;
          } else if (result.affectedRows === 2) {
            updated++;
          }
        } catch (err) {
          console.error(`⚠️  Error importing ${record.sku}: ${err.message}`);
          skipped++;
        }
      }
      
      // Progress update
      const processed = Math.min(i + batchSize, records.length);
      const percent = Math.round((processed / records.length) * 100);
      process.stdout.write(`\r   Progress: ${processed}/${records.length} (${percent}%) - Imported: ${imported}, Updated: ${updated}, Skipped: ${skipped}`);
    }
    
    console.log('\n');
    
    // Summary statistics
    const [stats] = await connection.execute(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT manufacturer) as manufacturers,
        COUNT(DISTINCT product_type) as product_types
      FROM product_catalog
    `);
    
    const [topManufacturers] = await connection.execute(`
      SELECT manufacturer, COUNT(*) as count
      FROM product_catalog
      GROUP BY manufacturer
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('\n📊 IMPORT COMPLETE!');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Total products in database: ${stats[0].total}`);
    console.log(`✅ Unique manufacturers: ${stats[0].manufacturers}`);
    console.log(`✅ Product types: ${stats[0].product_types}`);
    console.log(`✅ New records imported: ${imported}`);
    console.log(`✅ Records updated: ${updated}`);
    console.log(`⚠️  Records skipped: ${skipped}`);
    console.log('\n📈 Top 10 Manufacturers:');
    topManufacturers.forEach((row, idx) => {
      console.log(`   ${idx + 1}. ${row.manufacturer}: ${row.count} products`);
    });
    console.log('═══════════════════════════════════════\n');
    
  } catch (error) {
    console.error('❌ Error during import:', error);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('👋 Database connection closed\n');
    }
  }
}

// Run the import
if (require.main === module) {
  importCatalog()
    .then(() => {
      console.log('✨ Import script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Import script failed:', error);
      process.exit(1);
    });
}

module.exports = { importCatalog };
