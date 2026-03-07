// modules/utils/geoUtils.js
"use strict";

// ISO 3166-1 alpha-2 country code sets for geographic area classification.
// Mirrors the countryToArea logic used in the frontend.
const EUROPE = new Set([
  "AL","AD","AT","BE","BG","CH","CY","CZ","DE","DK","EE","ES","FI","FR",
  "GB","GR","HR","HU","IE","IS","IT","LI","LT","LU","LV","MC","MT","NL",
  "NO","PL","PT","RO","SE","SI","SK","SM","VA","UK",
]);
const ASIA = new Set([
  "AE","AF","AM","AZ","BD","BH","BN","BT","CN","GE","HK","ID","IN","IL",
  "IQ","IR","JO","JP","KG","KH","KP","KR","KW","KZ","LA","LB","LK","MM",
  "MN","MO","MV","MY","NP","OM","PH","PK","PS","QA","SA","SG","SY","TH",
  "TJ","TL","TM","TR","TW","UZ","VN","YE",
]);
const LATAM = new Set([
  "AR","BO","BR","BZ","CL","CO","CR","CU","DO","EC","SV","GF","GT","GY",
  "HN","JM","MX","NI","PA","PE","PR","PY","SR","UY","VE",
]);

/**
 * Map an ISO 3166-1 alpha-2 country code to a geographic area label.
 * Returns "Europe", "Asia", "Latam", or "North America" (default).
 * Returns null for empty/null input.
 * @param {string|null|undefined} country
 * @returns {string|null}
 */
function countryToArea(country) {
  if (!country) return null;
  const code = String(country).trim().toUpperCase();
  if (EUROPE.has(code)) return "Europe";
  if (ASIA.has(code))   return "Asia";
  if (LATAM.has(code))  return "Latam";
  return "North America";
}

module.exports = { countryToArea };
