// Local simulation of the first-auto filter against an in-memory SQLite that mimics D1.
// Run: node --no-warnings tests/first-auto.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadFirstAutoMap, filterFirstAutos } from '../worker/search-alerts.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../db/schema-prospects.sql', import.meta.url), 'utf8'));
const env = { DB: { prepare: sql => ({ all: async () => ({ results: db.prepare(sql).all() }) }) } };
const P = (id, name) => db.prepare(`INSERT INTO prospects (prospect_id, name, norm_name, side) VALUES (?,?,?, 'hitter')`).run(id, name, name.toLowerCase().replace(/[.'’]/g, '').replace(/-/g, ' '));
const C = (pid, name, year, pc, product, card, type = 'auto') => db.prepare(`INSERT INTO bowman_first_cards (name, norm_name, prospect_id, year, pc, product, card_number, card_type) VALUES (?,?,?,?,?,?,?,?)`).run(name, name.toLowerCase(), pid, year, pc, product, card, type);
P('adrian-santana', 'Adrian Santana'); P('gary-gill-hill', 'Gary Gill Hill'); P('dax-kilby', 'Dax Kilby'); P('new-guy', 'New Guy'); P('sir-jamison-jones', 'Sir Jamison Jones');
C('adrian-santana', 'Adrian Santana', 2023, 3, 'Bowman Draft', 'CDA-AS');
C('adrian-santana', 'Adrian Santana', 2024, 2, 'Bowman Chrome', 'CPA-AS');
C('gary-gill-hill', 'Gary Gill Hill', 2025, 1, 'Bowman', 'CPA-GG');
C('gary-gill-hill', 'Gary Gill Hill', 2025, 2, 'Bowman Chrome', 'CPA-GGH');
C('dax-kilby', 'Dax Kilby', 2026, 2, 'Bowman Chrome', 'CPA-DK');
C('dax-kilby', 'Dax Kilby', 2025, 3, 'Bowman Draft', 'CPA-DK');
C('dax-kilby', 'Dax Kilby', 2025, 3, 'Bowman Draft', 'BD-99', 'base');
const map = await loadFirstAutoMap(env, [{ prospectList: { min: 4, max: 5 } }]);
assert.equal(map.get('adrian santana').year, 2023);
assert.equal(map.get('gary gill hill').card, 'CPA-GG');
assert.equal(map.get('dax kilby').year, 2025, 'earliest auto wins, base cards ignored');
assert.equal(await loadFirstAutoMap(env, [{ query: 'x' }]), null, 'no prospect searches, no lookup');
assert.equal(await loadFirstAutoMap({ DB: { prepare: () => { throw new Error('no table'); } } }, [{ prospectList: {} }]), null, 'fails open');

const it = title => ({ title });
const keep = titles => filterFirstAutos(titles.map(it), map).map(i => i.title);
assert.deepEqual(keep(['2023 Bowman Draft Chrome Auto CDA-AS Adrian Santana']), ['2023 Bowman Draft Chrome Auto CDA-AS Adrian Santana'], 'first auto kept');
assert.deepEqual(keep(['2024 Bowman Chrome Prospect Auto CPA-AS Adrian Santana']), [], 'later year dropped');
assert.deepEqual(keep(['Adrian Santana 2023 Bowman Chrome Auto Rookie']), ['Adrian Santana 2023 Bowman Chrome Auto Rookie'], 'no card number: kept on year');
assert.deepEqual(keep(['2025 Bowman Chrome Prospect Auto CPA-GGH Gary Gill Hill']), [], 'same year, other product number dropped');
assert.deepEqual(keep(['2025 Bowman Chrome Prospect Auto CPA-GG Gary Gill Hill']).length, 1);
assert.deepEqual(keep(['2025 Bowman Draft Chrome Auto Dax Kilby CPA-DK']).length, 1, 'Kilby first auto is 2025 Draft');
assert.deepEqual(keep(['2026 Bowman Chrome Auto Dax Kilby CPA-DK']), [], '2026 Kilby dropped');
assert.deepEqual(keep(['2025 Bowman Draft Chrome Auto Gary Gill Hill']), [], 'Draft word on a non-Draft first auto dropped');
assert.equal(keep(['2019 Bowman Chrome Auto Somebody Else']).length, 1, 'unknown player fails open');
assert.equal(filterFirstAutos([it('x')], null).length, 1, 'no map fails open');
assert.deepEqual(keep(['2025 Bowman Chrome Dax Kilby Blue Mojo Auto /150 BMA-DK']), [], 'other auto codes (BMA-) dropped');
assert.deepEqual(keep(['2025 Bowman Draft Chrome Dax Kilby Auto BCP-12']), [], 'base-card codes dropped');
assert.deepEqual(keep(['2025 Bowman Draft Sapphire Dax Kilby Selections Auto']), [], 'Sapphire / Selections dropped');
assert.equal(keep(['2025 Bowman Draft Chrome Dax Kilby Auto CPA-DK PSA 10 PSA-DNA']).length, 1, 'grader words are not card codes');
assert.deepEqual(keep(['2025 Topps Bowman Chrome Dax Kilby CPA-DK Mojo Refractor Auto']), [], 'Mojo dropped');
console.log('first-auto: all passed');
