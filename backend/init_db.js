require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    console.log('Connecting to PostgreSQL database...');
    await client.connect();
    console.log('Connected successfully.');

    console.log('Reading schema.sql...');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');

    console.log('Executing schema...');
    await client.query(schemaSql);
    
    console.log('✅ Database schema initialized successfully!');
  } catch (error) {
    console.error('❌ Error initializing database schema:', error);
  } finally {
    await client.end();
    console.log('Connection closed.');
  }
}

initDatabase();
