// ── API Keys & Sheet IDs ───────────────────────────────────────────────────────
const SID         = '15pRN3ILeyfbPG2OMRxh0OUtqg6MZCaLMMjwf4yxDV74';
const TRACKER_SID = '12sNofzPwhb8uR68hT_bJNiLD2MrM0rdoQMPXGTlx2_s';
const KEY         = 'AIzaSyCl43LqZrRJ-MlPkKiKjk51O2Aklv-T0RE';
const BASE        = `https://sheets.googleapis.com/v4/spreadsheets/${SID}/values/`;
const TRACKER_BASE= `https://sheets.googleapis.com/v4/spreadsheets/${TRACKER_SID}/values/`;

// ── Team name lookup ───────────────────────────────────────────────────────────
const TEAM_NAMES = {
  ARI:'Arizona Diamondbacks',ATL:'Atlanta Braves',BAL:'Baltimore Orioles',
  BOS:'Boston Red Sox',CHC:'Chicago Cubs',CHW:'Chicago White Sox',
  CIN:'Cincinnati Reds',CLE:'Cleveland Guardians',COL:'Colorado Rockies',
  DET:'Detroit Tigers',HOU:'Houston Astros',KC:'Kansas City Royals',
  LAA:'Los Angeles Angels',LAD:'Los Angeles Dodgers',MIA:'Miami Marlins',
  MIL:'Milwaukee Brewers',MIN:'Minnesota Twins',NYM:'New York Mets',
  NYY:'New York Yankees',OAK:'Oakland Athletics',PHI:'Philadelphia Phillies',
  PIT:'Pittsburgh Pirates',SD:'San Diego Padres',SEA:'Seattle Mariners',
  SF:'San Francisco Giants',STL:'St. Louis Cardinals',TB:'Tampa Bay Rays',
  TEX:'Texas Rangers',TOR:'Toronto Blue Jays',WSN:'Washington Nationals',
  SFG:'San Francisco Giants',SDP:'San Diego Padres',TBR:'Tampa Bay Rays',WSH:'Washington Nationals'
};

// ── Sort options per tab ───────────────────────────────────────────────────────
const SORT_OPTS = {
  all:  [{k:'default',l:'BS'},{k:'rank',l:'Rank'},{k:'price',l:'Price'},{k:'owned',l:'$ Owned'}],
  hs:   [{k:'default',l:'Recent'},{k:'name',l:'Name'},{k:'owned',l:'$ Owned'}],
};

// ── Shared search bar (used by Home + Card Tracker) ────────────────────────────
function searchBarHTML(idPrefix, placeholder) {
  return `
    <div class="si">
      <input id="${idPrefix}-search" placeholder="${placeholder}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button id="${idPrefix}-clear">&times;</button>
      <div id="${idPrefix}-dropdown" class="qs-dropdown"></div>
    </div>
  `;
}

function wireSearchBar(idPrefix, getQuery, setQuery, onChange, onEnter) {
  const input = document.getElementById(`${idPrefix}-search`);
  const clearBtn = document.getElementById(`${idPrefix}-clear`);
  input.value = getQuery();
  clearBtn.classList.toggle('on', getQuery().length > 0);

  input.addEventListener('input', e => {
    setQuery(e.target.value);
    clearBtn.classList.toggle('on', e.target.value.length > 0);
    onChange();
  });
  if (onEnter) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
        onEnter();
      }
    });
  }
  clearBtn.addEventListener('click', () => {
    setQuery('');
    input.value = '';
    clearBtn.classList.remove('on');
    renderSearchDropdown(idPrefix, []);
    input.focus();
    onChange();
  });
}

function renderSearchDropdown(idPrefix, matches) {
  const dd = document.getElementById(`${idPrefix}-dropdown`);
  if (!dd) return;
  if (!matches.length) {
    dd.classList.remove('on');
    dd.innerHTML = '';
    return;
  }
  dd.innerHTML = matches.slice(0, 6).map(c => {
    const pDate = fmtShortDate(c.datePurchased);
    const sDate = c.salePrice ? fmtShortDate(c.transactionDate) : null;
    const dateLine = [
      c.itemId ? 'ID: ' + c.itemId : 'No item ID',
      pDate !== '—' ? 'Purchased ' + pDate : null,
      sDate && sDate !== '—' ? 'Sold ' + sDate : null
    ].filter(Boolean).join(' · ');
    return `
    <div class="qs-dd-item" onclick="ctOpenCard(${cards.indexOf(c)})" style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <div style="min-width:0">
        <div class="qs-dd-name">${c.fullCard || c.playerDisplay || '—'}</div>
        <div class="qs-dd-sub">${dateLine}</div>
      </div>
      ${c.itemId ? `<button onclick="event.stopPropagation();ctCopyId('${c.itemId.replace(/'/g,"\\'")}', this)" style="padding:5px 9px;border:1px solid var(--bdr2);border-radius:8px;background:var(--surf2);color:var(--tx2);font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Copy ID</button>` : ''}
    </div>
  `;
  }).join('');
  dd.classList.add('on');
}
