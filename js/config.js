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
  all:  [{k:'default',l:'BR'},{k:'rank',l:'Rank'},{k:'name',l:'Name'},{k:'price',l:'Price'},{k:'owned',l:'$ Owned'}],
  t200: [{k:'default',l:'Rank'},{k:'name',l:'Name'},{k:'price',l:'Price'},{k:'owned',l:'$ Owned'}],
  t100: [{k:'default',l:'Rank'},{k:'name',l:'Name'},{k:'price',l:'Price'},{k:'owned',l:'$ Owned'}],
  hs:   [{k:'default',l:'Recent'},{k:'weeks',l:'Weeks'},{k:'streak',l:'Streak'},{k:'name',l:'Name'},{k:'owned',l:'$ Owned'}],
};
