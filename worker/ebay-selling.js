// ── ebay-selling.js — GetMyeBaySelling polling + tag reconciliation
import { refreshAccessToken } from './ebay-watchlist.js';

export async function fetchMyeBaySelling(env) {
  let accessToken = await env.CACHE.get('ebay_access_token');

  if (!accessToken) {
    const refreshToken = await env.CACHE.get('ebay_refresh_token');
    if (!refreshToken) {
      return { error: 'not_authenticated', authUrl: '/auth' };
    }
    accessToken = await refreshAccessToken(refreshToken, env);
    if (!accessToken) {
      return { error: 'refresh_failed', authUrl: '/auth' };
    }
  }

  const res = await fetch('https://api.ebay.com/ws/api.dll', {
    method: 'POST',
    headers: {
      'X-EBAY-API-SITEID': '0',
      'X-EBAY-API-COMPATIBILITY-LEVEL': '967',
      'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
      'X-EBAY-API-IAF-TOKEN': accessToken,
      'Content-Type': 'text/xml',
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${accessToken}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </ActiveList>
        <SoldList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </SoldList>
        <UnsoldList>
          <Include>true</Include>
          <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
        </UnsoldList>
        <DetailLevel>ReturnAll</DetailLevel>
      </GetMyeBaySellingRequest>`
  });

  const xml = await res.text();

  const extractItemIds = (sectionTag) => {
    const sectionMatch = xml.match(new RegExp(`<${sectionTag}>([\\s\\S]*?)<\\/${sectionTag}>`));
    if (!sectionMatch) return [];
    const ids = [...sectionMatch[1].matchAll(/<ItemID>(.*?)<\/ItemID>/g)].map(m => m[1]);
    return [...new Set(ids)];
  };

  return {
    active: extractItemIds('ActiveList'),
    sold: extractItemIds('SoldList'),
    unsold: extractItemIds('UnsoldList'),
  };
}
