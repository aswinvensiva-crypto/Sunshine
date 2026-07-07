/**
 * rateShop.js — Competitor rate intelligence service.
 * Runs on a cron schedule (twice daily) and stores results in competitor_rates.
 *
 * Production: swap fetchCompetitorRates() body with a real OTA Insight API call
 * or a scraper targeting public OTA listing prices.
 * For now we persist mock rates that demonstrate the data structure.
 */
const { pool } = require('../config/db');

const COMPETITORS = [
  { resort_name: 'The Riverside Retreat',   room_type: 'Deluxe' },
  { resort_name: 'Palmgrove Heritage',       room_type: 'Superior' },
  { resort_name: 'Blue Lagoon Resort',       room_type: 'Standard' },
];

/**
 * Fetch competitor rates for the current night.
 * Replace this stub with a real OTA Insight / RateGain API call if available.
 */
async function fetchCompetitorRates() {
  // In production, call e.g.:
  //   const res = await fetch(`https://api.otainsight.com/v1/rates?date=${today}`, { headers: { ... } });
  //   return await res.json();
  // For now, return plausible mock rates ±10% around ₹6,000
  return COMPETITORS.map(c => ({
    ...c,
    rate: Math.round(5400 + Math.random() * 1200),
  }));
}

async function runRateShop() {
  console.log('[rateShop] Fetching competitor rates…');
  try {
    const rates = await fetchCompetitorRates();
    for (const r of rates) {
      await pool.query(
        `INSERT INTO competitor_rates (resort_name, room_type, rate, fetched_at)
         VALUES ($1, $2, $3, now())`,
        [r.resort_name, r.room_type, r.rate]
      );
    }
    console.log(`[rateShop] Stored ${rates.length} competitor rate(s)`);
  } catch (err) {
    console.error('[rateShop] Error:', err.message);
  }
}

module.exports = { runRateShop };
