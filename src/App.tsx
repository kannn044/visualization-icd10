import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { geoMercator, geoPath } from 'd3-geo';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, LabelList, PieChart, Pie, Legend
} from 'recharts';

interface EpisodeData {
  id: string;
  episode: number;
  episode_start: string;
  age_at_episode_start: number;
  have_in_drug_list: string;
  gender: string;
  zone_code: string;
  changwat: string;
  most_diagcode: string;
  first_diagcode: string;
  province_name?: string;
  diag2?: string;
}

type PopulationData = { [year: number]: { [ageBin: string]: number } };
type ProvinceTotalPop = { [year: number]: { [code: string]: number } };

// GeoJSON province name → 2-digit changwat code
const GEO_NAME_TO_CODE: Record<string, string> = {
  'Bangkok Metropolis': '10', 'Bangkok': '10',
  'Samut Prakan': '11', 'Nonthaburi': '12', 'Pathum Thani': '13',
  'Phra Nakhon Si Ayutthaya': '14', 'Ang Thong': '15', 'Lop Buri': '16',
  'Sing Buri': '17', 'Chai Nat': '18', 'Saraburi': '19',
  'Chon Buri': '20', 'Rayong': '21', 'Chanthaburi': '22',
  'Trat': '23', 'Chachoengsao': '24', 'Prachin Buri': '25',
  'Nakhon Nayok': '26', 'Sa Kaeo': '27',
  'Nakhon Ratchasima': '30', 'Korat': '30', 'Buri Ram': '31',
  'Surin': '32', 'Si Sa Ket': '33', 'Ubon Ratchathani': '34',
  'Yasothon': '35', 'Chaiyaphum': '36', 'Amnat Charoen': '37',
  'Bueng Kan': '38', 'Nong Bua Lam Phu': '39',
  'Khon Kaen': '40', 'Udon Thani': '41', 'Loei': '42',
  'Nong Khai': '43', 'Maha Sarakham': '44', 'Roi Et': '45',
  'Kalasin': '46', 'Sakon Nakhon': '47', 'Nakhon Phanom': '48',
  'Mukdahan': '49',
  'Chiang Mai': '50', 'Lamphun': '51', 'Lampang': '52',
  'Uttaradit': '53', 'Phrae': '54', 'Nan': '55',
  'Phayao': '56', 'Chiang Rai': '57', 'Mae Hong Son': '58',
  'Nakhon Sawan': '60', 'Uthai Thani': '61', 'Kamphaeng Phet': '62',
  'Tak': '63', 'Sukhothai': '64', 'Phitsanulok': '65',
  'Phichit': '66', 'Phetchabun': '67',
  'Ratchaburi': '70', 'Kanchanaburi': '71', 'Suphan Buri': '72',
  'Nakhon Pathom': '73', 'Samut Sakhon': '74', 'Samut Songkhram': '75',
  'Phetchaburi': '76', 'Prachuap Khiri Khan': '77',
  'Nakhon Si Thammarat': '80', 'Krabi': '81',
  'Phangnga': '82', 'Phang Nga': '82', 'Phuket': '83',
  'Surat Thani': '84', 'Ranong': '85', 'Chumphon': '86',
  'Songkhla': '90', 'Satun': '91', 'Trang': '92',
  'Phatthalung': '93', 'Phatalung': '93', 'Pattani': '94',
  'Yala': '95', 'Narathiwat': '96',
};

interface AddressData {
  changwat: string;
  province_name: string;
}

const MALE_COLOR = '#4C72B0';
const FEMALE_COLOR = '#C44E52';

const AGE_LABELS = ["0-17", "18-29", "30-39", "40-49", "50-59", "60-69", "70-79", "80+"];
const getAgeBin = (age: number) => {
  if (age < 18) return "0-17";
  if (age < 30) return "18-29";
  if (age < 40) return "30-39";
  if (age < 50) return "40-49";
  if (age < 60) return "50-59";
  if (age < 70) return "60-69";
  if (age < 80) return "70-79";
  return "80+";
};

const AGE_LABELS_5Y = ["0-4","5-9","10-14","15-19","20-24","25-29","30-34","35-39","40-44","45-49","50-54","55-59","60-64","65-69","70+"];
const getAgeBin5Y = (age: number): string => {
  if (age < 5)  return "0-4";
  if (age < 10) return "5-9";
  if (age < 15) return "10-14";
  if (age < 20) return "15-19";
  if (age < 25) return "20-24";
  if (age < 30) return "25-29";
  if (age < 35) return "30-34";
  if (age < 40) return "35-39";
  if (age < 45) return "40-44";
  if (age < 50) return "45-49";
  if (age < 55) return "50-54";
  if (age < 60) return "55-59";
  if (age < 65) return "60-64";
  if (age < 70) return "65-69";
  return "70+";
};

const ALL_YEARS = [2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024];
const YEAR_COLORS = [
  '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
  '#8c564b','#e377c2','#636363','#bcbd22','#17becf',
  '#9edae5','#ffbb78','#98df8a','#ff9896','#c5b0d5'
];
const AGE_COLORS = [
  '#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd',
  '#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf',
  '#aec7e8','#ffbb78','#98df8a','#ff9896','#c5b0d5'
];

// ── Venn Diagram helpers ──────────────────────────────────────────────────────

interface VennRegions {
  total: number;
  ep1Size: number;
  ep2Size: number;
  ep1DrugSize: number;
  only1: number;
  only2: number;
  only3: number;
  only12: number;
  only13: number;
  only23: number;
  all3: number;
}

function computeVennRegions(subset: EpisodeData[]): VennRegions | null {
  if (subset.length === 0) return null;
  const hasDrug = (d: EpisodeData) => String(d.have_in_drug_list).includes('True');
  const ep1     = new Set(subset.filter(d => d.episode >= 1).map(d => d.id));
  const ep2     = new Set(subset.filter(d => d.episode >= 2).map(d => d.id));
  const ep1Drug = new Set(subset.filter(d => d.episode >= 1 && hasDrug(d)).map(d => d.id));
  const i12     = new Set([...ep1].filter(id => ep2.has(id)));
  const i13     = new Set([...ep1].filter(id => ep1Drug.has(id)));
  const i23     = new Set([...ep2].filter(id => ep1Drug.has(id)));
  const i123    = new Set([...i12].filter(id => ep1Drug.has(id)));
  return {
    total:      new Set(subset.map(d => d.id)).size,
    ep1Size:    ep1.size,
    ep2Size:    ep2.size,
    ep1DrugSize: ep1Drug.size,
    only1:  ep1.size    - i12.size  - i13.size  + i123.size,
    only2:  ep2.size    - i12.size  - i23.size  + i123.size,
    only3:  ep1Drug.size - i13.size - i23.size  + i123.size,
    only12: i12.size  - i123.size,
    only13: i13.size  - i123.size,
    only23: i23.size  - i123.size,
    all3:   i123.size,
  };
}

function VennSVG({ v, diagCode, diagType }: { v: VennRegions; diagCode: string; diagType: string }) {
  const BLUE  = '#4C72B0';
  const GREEN = '#55A868';
  const RED   = '#C44E52';

  const lbl = (x: number, y: number, val: number) => (
    <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
          fontSize={13} fontWeight="bold" fill="#1f1f1f">
      {val.toLocaleString()}
    </text>
  );

  const pct = (n: number) => v.total > 0 ? `${((n / v.total) * 100).toFixed(1)}%` : '—';
  const infoLines = [
    { label: 'Total patients',           val: v.total,       pct: null },
    { label: 'Episode ≥ 1',              val: v.ep1Size,     pct: pct(v.ep1Size) },
    { label: 'Episode ≥ 2',              val: v.ep2Size,     pct: pct(v.ep2Size) },
    { label: 'Episode ≥ 1 & Drug=True',  val: v.ep1DrugSize, pct: pct(v.ep1DrugSize) },
    { label: 'All three',                val: v.all3,        pct: pct(v.all3) },
  ];

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
      <h5 style={{ margin: 0, fontSize: '1.05rem', color: '#4a5568', fontWeight: 700 }}>
        {diagType} = <span style={{ color: 'var(--primary)' }}>{diagCode}</span>
        &nbsp;—&nbsp;n={v.total.toLocaleString()} patients
      </h5>

      <svg viewBox="0 0 500 490" style={{ width: '100%', maxWidth: 440 }}>
        {/* Circles */}
        <circle cx={170} cy={190} r={130} fill={BLUE}  fillOpacity={0.35} stroke="white" strokeWidth={2} />
        <circle cx={330} cy={190} r={130} fill={GREEN} fillOpacity={0.35} stroke="white" strokeWidth={2} />
        <circle cx={250} cy={310} r={130} fill={RED}   fillOpacity={0.35} stroke="white" strokeWidth={2} />

        {/* Region counts */}
        {lbl(90,  175, v.only1)}   {/* only A */}
        {lbl(410, 175, v.only2)}   {/* only B */}
        {lbl(250, 415, v.only3)}   {/* only C */}
        {lbl(250, 148, v.only12)}  {/* A∩B ¬C */}
        {lbl(163, 310, v.only13)}  {/* A∩C ¬B */}
        {lbl(337, 310, v.only23)}  {/* B∩C ¬A */}
        {lbl(250, 247, v.all3)}    {/* all three */}

        {/* Set labels */}
        <text x={65}  y={52} textAnchor="middle" fontSize={13} fontWeight="bold" fill={BLUE} >Episode ≥ 1</text>
        <text x={435} y={52} textAnchor="middle" fontSize={13} fontWeight="bold" fill={GREEN}>Episode ≥ 2</text>
        <text x={250} y={460} textAnchor="middle" fontSize={12} fontWeight="bold" fill={RED}  >Episode ≥ 1 &amp; Drug=True</text>
      </svg>

      {/* Stats table */}
      <table style={{ fontSize: '0.88rem', borderCollapse: 'collapse', width: '100%', maxWidth: 380 }}>
        <tbody>
          {infoLines.map(row => (
            <tr key={row.label} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '4px 8px', color: '#374151' }}>{row.label}</td>
              <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600 }}>{row.val.toLocaleString()}</td>
              {row.pct !== null && (
                <td style={{ padding: '4px 8px', textAlign: 'right', color: '#6b7280' }}>{row.pct}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Thailand GeoMap ─────────────────────────────────────────────────────────

function ThailandGeoMap({
  rateData, geoData, title,
}: {
  rateData: Array<{ code: string; rate: number; count: number }>;
  geoData: any;
  title: string;
}) {
  const W = 420;
  const H = 560;

  const projection = useMemo(() => geoMercator().fitSize([W, H], geoData), [geoData]);
  const pathGen    = useMemo(() => geoPath().projection(projection), [projection]);

  const rateMap = useMemo(
    () => new Map(rateData.map(d => [d.code, d])),
    [rateData]
  );
  const maxRate = useMemo(
    () => Math.max(...rateData.map(d => d.rate), 1),
    [rateData]
  );

  const getColor = (code: string) => {
    const entry = rateMap.get(code);
    if (!entry || entry.rate <= 0) return '#e5e7eb';
    const t = entry.rate / maxRate;
    const r = Math.round(240 - 205 * t);
    const g = Math.round(249 - 182 * t);
    const b = Math.round(255 - 130 * t);
    return `rgb(${Math.max(0, r)},${Math.max(0, g)},${Math.max(35, b)})`;
  };

  const legendGrad = `linear-gradient(to right, rgb(240,249,255), rgb(35,67,125))`;

  return (
    <div className="card chart-card">
      <h5 style={{ marginBottom: '0.5rem' }}>{title}</h5>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: 520 }}>
        {geoData.features.map((feature: any, idx: number) => {
          const name = feature.properties?.name || '';
          const code = GEO_NAME_TO_CODE[name] || '';
          const d = pathGen(feature);
          if (!d) return null;
          const entry = rateMap.get(code);
          const tooltip = entry
            ? `${name} (${code}): ${entry.rate.toFixed(2)} per 100k (n=${entry.count})`
            : `${name}: no data`;
          return (
            <path key={idx} d={d} fill={getColor(code)} stroke="white" strokeWidth={0.5}>
              <title>{tooltip}</title>
            </path>
          );
        })}
      </svg>
      {/* Color legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#374151' }}>
        <span>0</span>
        <div style={{ flex: 1, height: 10, borderRadius: 4, background: legendGrad, border: '1px solid #d1d5db' }} />
        <span>{maxRate.toFixed(1)}</span>
        <span style={{ color: '#6b7280' }}>per 100k</span>
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ display: 'inline-block', width: 14, height: 14, background: '#e5e7eb', border: '1px solid #d1d5db', borderRadius: 2 }} />
        No data
      </div>
    </div>
  );
}

export default function App() {
  const [rawData, setRawData] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [viewType, setViewType] = useState<'most_diagcode' | 'first_diagcode' | 'diag2'>('most_diagcode');
  const [diagFilter, setDiagFilter] = useState('All');
  const [genderFilter, setGenderFilter] = useState({ all: true, male: false, female: false });
  const [zoneFilter, setZoneFilter] = useState('All');
  const [selectedRateYear, setSelectedRateYear] = useState<number>(2024);
  const [populationData, setPopulationData] = useState<PopulationData>({});
  const [provincePopData, setProvincePopData] = useState<ProvinceTotalPop>({});
  const [thailandGeo, setThailandGeo] = useState<any>(null);

  const handleGenderToggle = (type: 'all' | 'male' | 'female') => {
    if (type === 'all') {
      setGenderFilter({ all: true, male: false, female: false });
    } else {
      setGenderFilter(prev => {
        const next = { ...prev, [type]: !prev[type], all: false };
        if (!next.male && !next.female) {
          return { all: true, male: false, female: false };
        }
        return next;
      });
    }
  };

  useEffect(() => {
    const fetchCSV = async () => {
      const addressRes = await fetch('./address.csv');
      const addressText = await addressRes.text();
      const addressResult = Papa.parse(addressText, { header: true, dynamicTyping: true, skipEmptyLines: true });
      const addressMap = new Map();
      (addressResult.data as AddressData[]).forEach(row => {
        if (row.changwat && row.province_name) {
          addressMap.set(String(row.changwat), String(row.province_name));
          addressMap.set(String(row.province_name), String(row.province_name));
        }
      });

      const episodeRes = await fetch('./episode_details_10mar2026.csv');
      const episodeText = await episodeRes.text();
      const episodeResult = Papa.parse(episodeText, { header: true, dynamicTyping: true, skipEmptyLines: true });
      
      const data = (episodeResult.data as EpisodeData[]).map(d => {
        const cleanMost = String(d.most_diagcode || '').replace(/"/g, '').trim();
        const cleanFirst = String(d.first_diagcode || '').replace(/"/g, '').trim();
        const cleanChangwat = String(d.changwat || '').replace(/"/g, '').trim();
        return {
          ...d,
          most_diagcode: cleanMost,
          first_diagcode: cleanFirst,
          changwat: cleanChangwat,
          province_name: addressMap.get(cleanChangwat) || `Unknown (${cleanChangwat})`,
          diag2: (cleanFirst === 'A318' || cleanFirst === 'A319') ? 'A310' : cleanFirst
        };
      });
      
      setRawData(data);

      // Load population data for all years in parallel
      const popEntries = await Promise.all(
        ALL_YEARS.map(async (year) => {
          const thaiYear = year + 543;
          const popRes = await fetch(`./pop${thaiYear}.csv`);
          const popText = await popRes.text();
          const parsed = Papa.parse(popText, { header: false, dynamicTyping: false, skipEmptyLines: false });
          const rows = parsed.data as string[][];
          // Identify the national total row purely by numeric threshold:
          // col[2] = male 0-4 pop (always > 500,000 for Thailand national total)
          // col[4] = total 0-4 pop (always > 1,000,000 for Thailand national total)
          // This avoids all Thai string / Unicode normalisation issues.
          const natRow = rows.find(r => {
            const c2 = parseInt((r[2] || '').replace(/,/g, ''), 10);
            const c4 = parseInt((r[4] || '').replace(/,/g, ''), 10);
            return c2 > 500_000 && c4 > 1_000_000;
          });
          const popByAge: { [ageBin: string]: number } = {};
          if (natRow) {
            AGE_LABELS_5Y.forEach((label, i) => {
              const colIndex = 4 + 3 * i;
              const val = parseInt(String(natRow[colIndex] || '0').replace(/,/g, ''), 10);
              popByAge[label] = isNaN(val) ? 0 : val;
            });
          }
          // Province-level total population (col[49] = grand total)
          const provPop: { [code: string]: number } = {};
          rows.forEach(r => {
            const code = String(r[0] || '').trim().replace(/"/g, '');
            if (/^\d{2}$/.test(code)) {
              const total = parseInt(String(r[49] || '0').replace(/,/g, ''), 10);
              if (!isNaN(total) && total > 0) provPop[code] = total;
            }
          });
          return [year, popByAge, provPop] as [number, { [ageBin: string]: number }, { [code: string]: number }];
        })
      );
      setPopulationData(Object.fromEntries(popEntries.map(([y, ages]) => [y, ages])) as PopulationData);
      const provMap: ProvinceTotalPop = {};
      popEntries.forEach(([y, , provs]) => { provMap[y as number] = provs as { [code: string]: number }; });
      setProvincePopData(provMap);

      // Fetch Thailand provinces GeoJSON
      try {
        const geoRes = await fetch('https://raw.githubusercontent.com/apisit/thailand.json/master/thailand.json');
        if (geoRes.ok) {
          const geoJson = await geoRes.json();
          setThailandGeo(geoJson);
        }
      } catch { /* map optional */ }

      setLoading(false);
    };
    
    fetchCSV();
  }, []);

  const getProcessedData = (criteria: 'union' | 'inter') => {
    if (rawData.length === 0) return [];
    const hasDrugTrue = (d: EpisodeData) => String(d.have_in_drug_list).includes('True');
    const s2Set = new Set(rawData.filter(d => d.episode >= 2).map(d => d.id));
    const s3Set = new Set(rawData.filter(d => d.episode >= 1 && hasDrugTrue(d)).map(d => d.id));
    
    let targetIds: Set<string>;
    if (criteria === 'inter') {
      targetIds = new Set([...s2Set].filter(id => s3Set.has(id)));
    } else {
      targetIds = new Set([...s2Set, ...s3Set]);
    }

    let dff = rawData.filter(d => targetIds.has(d.id));
    if (diagFilter !== 'All') dff = dff.filter(d => d[viewType] === diagFilter);
    if (!genderFilter.all) {
      if (genderFilter.male && !genderFilter.female) dff = dff.filter(d => d.gender === 'male');
      else if (!genderFilter.male && genderFilter.female) dff = dff.filter(d => d.gender === 'female');
      else if (!genderFilter.male && !genderFilter.female) dff = [];
    }
    if (zoneFilter !== 'All') dff = dff.filter(d => String(d.zone_code) === String(zoneFilter));
    
    return dff;
  };

  const unionData = useMemo(() => getProcessedData('union'), [rawData, diagFilter, viewType, genderFilter, zoneFilter]);
  const interData = useMemo(() => getProcessedData('inter'), [rawData, diagFilter, viewType, genderFilter, zoneFilter]);

  const getStats = (data: EpisodeData[]) => {
    const seen = new Set<string>();
    const totalUnique = new Set(data.map(d => d.id)).size;

    // Gender
    const genderCounts: any = { male: 0, female: 0, total: 0 };
    const genderSeen = new Set<string>();
    data.forEach(d => {
      if (!genderSeen.has(d.id)) {
        if (d.gender === 'male') genderCounts.male++;
        else if (d.gender === 'female') genderCounts.female++;
        genderCounts.total++;
        genderSeen.add(d.id);
      }
    });

    // Age
    const ageStats: any = {};
    const ageSeen = new Set<string>();
    AGE_LABELS_5Y.forEach(l => ageStats[l] = { male: 0, female: 0, total: 0 });
    data.forEach(d => {
      if (!ageSeen.has(d.id)) {
        const bin = getAgeBin5Y(d.age_at_episode_start);
        if (d.gender === 'male') ageStats[bin].male++;
        else if (d.gender === 'female') ageStats[bin].female++;
        ageStats[bin].total++;
        ageSeen.add(d.id);
      }
    });

    // Zone
    const zoneStats: any = {};
    const zoneSeen = new Set<string>();
    data.forEach(d => {
      if (d.zone_code && !zoneSeen.has(d.id)) {
        const z = String(d.zone_code);
        if (!zoneStats[z]) zoneStats[z] = { male: 0, female: 0, total: 0 };
        if (d.gender === 'male') zoneStats[z].male++;
        else if (d.gender === 'female') zoneStats[z].female++;
        zoneStats[z].total++;
        zoneSeen.add(d.id);
      }
    });

    // Province
    const provStats: any = {};
    const provSeen = new Set<string>();
    data.forEach(d => {
      if (d.province_name && !provSeen.has(d.id)) {
        const p = d.province_name;
        if (!provStats[p]) provStats[p] = { male: 0, female: 0, total: 0 };
        if (d.gender === 'male') provStats[p].male++;
        else if (d.gender === 'female') provStats[p].female++;
        provStats[p].total++;
        provSeen.add(d.id);
      }
    });

    return {
      totalUnique,
      gender: [
        { name: 'male', value: genderCounts.male },
        { name: 'female', value: genderCounts.female }
      ],
      age: AGE_LABELS_5Y.map(name => ({ name, ...ageStats[name] })),
      zone: Object.entries(zoneStats).map(([name, val]: any) => ({ name, ...val })).sort((a,b) => parseInt(a.name) - parseInt(b.name)),
      province: Object.entries(provStats).map(([name, val]: any) => ({ name, ...val })).sort((a,b) => b.total - a.total).slice(0, 10)
    };
  };

  const unionStats = useMemo(() => getStats(unionData), [unionData]);
  const interStats = useMemo(() => getStats(interData), [interData]);

  const getAgeRateForYear = (data: EpisodeData[], popData: PopulationData, year: number) => {
    if (!data.length || !Object.keys(popData).length) return [];
    const counts: { [ageBin: string]: number } = {};
    AGE_LABELS_5Y.forEach(a => { counts[a] = 0; });
    const seen = new Set<string>();
    data.forEach(d => {
      if (!d.episode_start) return;
      const epYear = parseInt(String(d.episode_start).substring(0, 4), 10);
      if (epYear !== year) return;
      if (seen.has(d.id)) return;
      seen.add(d.id);
      counts[getAgeBin5Y(d.age_at_episode_start)]++;
    });
    return AGE_LABELS_5Y.map(bin => {
      const pop = popData[year]?.[bin] ?? 0;
      return { name: bin, rate: pop > 0 ? parseFloat(((counts[bin] / pop) * 100000).toFixed(2)) : 0 };
    });
  };

  const getProvinceRateByYear = (data: EpisodeData[], provPop: ProvinceTotalPop, year: number) => {
    if (!data.length || !Object.keys(provPop).length) return [];
    const counts: { [code: string]: number } = {};
    const seen = new Set<string>();
    data.forEach(d => {
      if (!d.episode_start) return;
      const epYear = parseInt(String(d.episode_start).substring(0, 4), 10);
      if (epYear !== year) return;
      const code = String(d.changwat || '').trim().replace(/"/g, '');
      const key = `${d.id}|${code}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (!counts[code]) counts[code] = 0;
      counts[code]++;
    });
    const popByCode = provPop[year] || {};
    return Object.entries(counts)
      .map(([code, cnt]) => ({
        code,
        rate: popByCode[code] ? parseFloat(((cnt / popByCode[code]) * 100000).toFixed(2)) : 0,
        count: cnt,
      }))
      .filter(d => d.rate > 0);
  };

  const unionAgeRateData = useMemo(
    () => getAgeRateForYear(unionData, populationData, selectedRateYear),
    [unionData, populationData, selectedRateYear]
  );
  const interAgeRateData = useMemo(
    () => getAgeRateForYear(interData, populationData, selectedRateYear),
    [interData, populationData, selectedRateYear]
  );
  const unionProvRateData = useMemo(
    () => getProvinceRateByYear(unionData, provincePopData, selectedRateYear),
    [unionData, provincePopData, selectedRateYear]
  );
  const interProvRateData = useMemo(
    () => getProvinceRateByYear(interData, provincePopData, selectedRateYear),
    [interData, provincePopData, selectedRateYear]
  );

  const VENN_CODES = ['A310', 'A311', 'A318', 'A319'] as const;
  const vennData = useMemo(() => {
    const first: Record<string, VennRegions | null> = {};
    const most: Record<string, VennRegions | null> = {};
    VENN_CODES.forEach(code => {
      first[code] = computeVennRegions(rawData.filter(d => d.first_diagcode === code));
      most[code]  = computeVennRegions(rawData.filter(d => d.most_diagcode  === code));
    });
    return { first, most };
  }, [rawData]);

  if (loading) return <div className="loading">Comparing Patterns...</div>;

  const RenderComparison = ({ title, dataUnion, dataInter, layout = 'horizontal' as 'horizontal' | 'vertical' }: any) => (
    <div className="comparison-row">
      <h3 className="section-title">{title}</h3>
      <div className="comparison-grid">
        <div className="card chart-card">
          <h5>Union (2U3) Pattern - n={unionStats.totalUnique.toLocaleString()}</h5>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dataUnion} layout={layout} margin={{ top: 20, right: 30, left: layout === 'vertical' ? 30 : 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={layout === 'horizontal'} horizontal={layout === 'vertical'} />
              {layout === 'horizontal' ? <XAxis dataKey="name" /> : <XAxis type="number" />}
              {layout === 'horizontal' ? <YAxis /> : <YAxis dataKey="name" type="category" width={150} fontSize={12} interval={0} />}
              <Tooltip />
              <Legend />
              {genderFilter.all ? (
                <Bar dataKey="total" fill="#8884d8" name="Total" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />
              ) : (
                <>
                  {genderFilter.male && <Bar dataKey="male" fill={MALE_COLOR} name="Male" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />}
                  {genderFilter.female && <Bar dataKey="female" fill={FEMALE_COLOR} name="Female" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />}
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card chart-card">
          <h5>Intersection (2∩3) Pattern - n={interStats.totalUnique.toLocaleString()}</h5>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={dataInter} layout={layout} margin={{ top: 20, right: 30, left: layout === 'vertical' ? 30 : 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={layout === 'horizontal'} horizontal={layout === 'vertical'} />
              {layout === 'horizontal' ? <XAxis dataKey="name" /> : <XAxis type="number" />}
              {layout === 'horizontal' ? <YAxis /> : <YAxis dataKey="name" type="category" width={150} fontSize={12} interval={0} />}
              <Tooltip />
              <Legend />
              {genderFilter.all ? (
                <Bar dataKey="total" fill="#8884d8" name="Total" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />
              ) : (
                <>
                  {genderFilter.male && <Bar dataKey="male" fill={MALE_COLOR} name="Male" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />}
                  {genderFilter.female && <Bar dataKey="female" fill={FEMALE_COLOR} name="Female" radius={layout === 'horizontal' ? [4, 4, 0, 0] : [0, 4, 4, 0]} />}
                </>
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );

  return (
    <div className="dashboard-container">
      <h1 className="title">NTM (A31) Clinical Comparison Dashboard</h1>

      {/* === Info / Description Card === */}
      <div className="card" style={{ marginBottom: '2rem', background: 'linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%)', borderLeft: '5px solid var(--primary)' }}>
        <h2 style={{ margin: '0 0 0.75rem 0', color: 'var(--primary)', fontSize: '1.15rem', fontWeight: 700 }}>
          📋 คำอธิบายแดชบอร์ด — NTM (Non-Tuberculous Mycobacteria, ICD-10: A31)
        </h2>
        <p style={{ marginBottom: '1.25rem', lineHeight: 1.85, color: '#374151', fontSize: '0.95rem' }}>
          แดชบอร์ดนี้แสดงและเปรียบเทียบข้อมูลทางคลินิกของผู้ป่วยโรค Non-Tuberculous Mycobacteria (NTM)
          ในระบบฐานข้อมูลผู้ป่วยนอก/ใน โดยวิเคราะห์ในระดับ <strong>Episode</strong> (ช่วงเวลาที่ผู้ป่วยรับการดูแลต่อเนื่อง)
          และแบ่งผู้ป่วยออกเป็นสองกลุ่มเปรียบเทียบตามเกณฑ์ด้านล่าง
        </p>

        <h3 style={{ margin: '0 0 0.75rem 0', color: 'var(--primary)', fontSize: '1rem', fontWeight: 700 }}>
          🔖 นิยามของตัวแปร Classification Basis
        </h3>
        <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {/* most_diagcode */}
          <div style={{ padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.75)', borderRadius: '8px', borderLeft: '4px solid #3b82f6' }}>
            <div style={{ fontWeight: 700, color: '#1d4ed8', marginBottom: '0.3rem' }}>1. most_diagcode</div>
            <div style={{ lineHeight: 1.8, color: '#374151', fontSize: '0.93rem' }}>
              รหัสการวินิจฉัย (diagnosis code) ที่ถูกบันทึก<strong>มากที่สุด</strong>ใน episode ของผู้ป่วยคนนั้น
              โดยนับจาก<strong>ความถี่</strong>ที่ปรากฏในทุก visit ของ episode
              หากมีความถี่เท่ากันหลายรหัส ระบบจะเลือก diagcode ตามลำดับแรก
            </div>
          </div>

          {/* first_diagcode */}
          <div style={{ padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.75)', borderRadius: '8px', borderLeft: '4px solid #10b981' }}>
            <div style={{ fontWeight: 700, color: '#065f46', marginBottom: '0.3rem' }}>2. first_diagcode</div>
            <div style={{ lineHeight: 1.8, color: '#374151', fontSize: '0.93rem' }}>
              รหัส diagcode <strong>แรกสุด</strong>ที่ผู้ป่วยได้รับใน episode นั้น
              นับจาก visit ที่เริ่มต้น episode เป็นต้นไป
              เหมาะสำหรับวิเคราะห์การวินิจฉัยเริ่มต้นของผู้ป่วย
            </div>
          </div>

          {/* assume_diagcode */}
          <div style={{ padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.75)', borderRadius: '8px', borderLeft: '4px solid #f59e0b' }}>
            <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '0.3rem' }}>3. assume_diagcode &nbsp;(A318 / A319 → A310)</div>
            <div style={{ lineHeight: 1.8, color: '#374151', fontSize: '0.93rem' }}>
              ใช้ <strong>first_diagcode</strong> เป็นฐาน แล้วแปลง A318 และ A319
              ให้เป็น <strong>A310</strong> ทั้งหมด เพื่อรวมกลุ่ม NTM ที่ไม่ระบุชนิดเข้าด้วยกัน
              เนื่องจาก A318 (Other specified) และ A319 (Unspecified) มักใช้แทนกันในทางปฏิบัติ
              ส่วน A311 (Cutaneous mycobacterial infection) ยังคงแยกรหัสเดิม
            </div>
          </div>
        </div>

        <h3 style={{ margin: '0 0 0.75rem 0', color: 'var(--primary)', fontSize: '1rem', fontWeight: 700 }}>
          🔢 นิยามของ Union (2∪3) และ Intersection (2∩3)
        </h3>
        <div style={{ padding: '0.85rem 1rem', background: 'rgba(255,255,255,0.75)', borderRadius: '8px', borderLeft: '4px solid #8b5cf6', marginBottom: '1rem' }}>
          <div style={{ lineHeight: 1.85, color: '#374151', fontSize: '0.93rem' }}>
            <p style={{ margin: '0 0 0.5rem 0' }}>ตัวเลข <strong>1, 2, 3</strong> ในชื่อเงื่อนไขหมายถึงกลุ่มผู้ป่วยที่กำหนดไว้ดังนี้:</p>
            <ul style={{ margin: '0 0 0.75rem 1.25rem', padding: 0, lineHeight: 2 }}>
              <li>
                <strong>กลุ่ม 1</strong> — episode ที่มีบันทึก visit <strong>ตั้งแต่ 1 ครั้งขึ้นไป</strong>
                (ครอบคลุมผู้ป่วยทุกราย)
              </li>
              <li>
                <strong>กลุ่ม 2</strong> — episode ที่มีบันทึก visit <strong>ตั้งแต่ 2 ครั้งขึ้นไป</strong>
                (ผู้ป่วยที่กลับมาติดตามอย่างน้อย 1 ครั้ง)
              </li>
              <li>
                <strong>กลุ่ม 3</strong> — episode ที่มีบันทึก visit <strong>ตั้งแต่ 2 ครั้งขึ้นไป</strong>{' '}
                <em>และ</em> ได้รับ<strong>ยา NTM</strong> (have_in_drug_list = True) อย่างน้อย 1 ครั้งใน episode นั้น
                (ผู้ป่วยที่ได้รับการรักษาด้วยยาจริง)
              </li>
            </ul>
            <p style={{ margin: '0 0 0.4rem 0' }}>
              <strong style={{ color: '#7c3aed' }}>Union (2∪3)</strong> —
              นับผู้ป่วยที่ตรงเงื่อนไข<strong>กลุ่ม 2 หรือกลุ่ม 3 อย่างใดอย่างหนึ่ง</strong>
              ครอบคลุมทั้งกลุ่มที่กลับมา visit บ่อยและกลุ่มที่ได้รับยา
              จึงมีจำนวนผู้ป่วยมากกว่า Intersection
            </p>
            <p style={{ margin: 0 }}>
              <strong style={{ color: '#7c3aed' }}>Intersection (2∩3)</strong> —
              นับเฉพาะผู้ป่วยที่ตรง<strong>ทั้งสองเงื่อนไขพร้อมกัน</strong>
              (visit ≥ 1 ครั้ง <em>และ</em> ได้รับยา)
              กลุ่มนี้มีแนวโน้มสูงว่าได้รับการวินิจฉัยและเริ่มรักษาจริงในทางคลินิก
            </p>
          </div>
        </div>

        <p style={{ margin: 0, fontSize: '0.83rem', color: '#6b7280', borderTop: '1px solid #d1d5db', paddingTop: '0.75rem' }}>
          <strong>หมายเหตุ:</strong>{' '}
          ค่า <em>n</em> ที่แสดงในหัวกราฟแต่ละอัน คือจำนวน episode ที่ไม่ซ้ำกัน (unique episodes)
          หลังจากกรองตามตัวแปร Classification Basis, Diagnosis Code, Gender และ Zone ที่เลือก
          กราฟอัตราการเกิดโรค (Rate per 100,000) คำนวณโดยใช้ข้อมูลประชากรไทยรายปีแยกตามกลุ่มอายุ 5 ปี
        </p>
      </div>

      <div className="card filter-card mb-8">
        <div className="filter-grid">
          <div className="filter-item">
            <label>Classification Basis</label>
            <select value={viewType} onChange={e => setViewType(e.target.value as any)}>
              <option value="most_diagcode">most_diagcode</option>
              <option value="first_diagcode">first_diagcode</option>
              <option value="diag2">assume diagcode A318/9 to A310</option>
            </select>
          </div>
          <div className="filter-item">
            <label>Diagnosis Code</label>
            <select value={diagFilter} onChange={e => setDiagFilter(e.target.value)}>
              <option>All</option>
              {['A310', 'A311', 'A318', 'A319'].map(d => <option key={d}>{d}</option>)}
            </select>
          </div>
          <div className="filter-item">
            <label>Gender Filter</label>
            <div style={{ display: 'flex', gap: '15px', marginTop: '8px', fontSize: '14px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={genderFilter.all} onChange={() => handleGenderToggle('all')} />
                All
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={genderFilter.male} onChange={() => handleGenderToggle('male')} />
                Male
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                <input type="checkbox" checked={genderFilter.female} onChange={() => handleGenderToggle('female')} />
                Female
              </label>
            </div>
          </div>
          <div className="filter-item">
            <label>Zone Filter</label>
            <select value={zoneFilter} onChange={e => setZoneFilter(e.target.value)}>
              <option>All</option>
              {Array.from({length: 13}, (_, i) => i + 1).map(z => <option key={String(z)} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
      </div>

      <RenderComparison title="Age Distribution Patterns" dataUnion={unionStats.age} dataInter={interStats.age} />
      <RenderComparison title="Health Zone Patterns" dataUnion={unionStats.zone} dataInter={interStats.zone} />
      <RenderComparison title="Geographical Patterns (Top 10 Provinces)" dataUnion={unionStats.province} dataInter={interStats.province} layout="vertical" />

      {/* === Rate Bar Chart by Age Group (5-Year Bands) === */}
      <div className="comparison-row">
        <h3 className="section-title">Episode Rate per 100,000 Population by Age Group (5-Year Bands)</h3>

        {/* Year dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
          <label style={{ fontWeight: 600, fontSize: '14px' }}>Year:</label>
          <select
            value={selectedRateYear}
            onChange={e => setSelectedRateYear(parseInt(e.target.value))}
            style={{ fontSize: '14px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', cursor: 'pointer' }}
          >
            {ALL_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="comparison-grid">
          <div className="card chart-card">
            <h5>Union (2U3) Pattern &mdash; rate per 100k ({selectedRateYear})</h5>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={unionAgeRateData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis label={{ value: 'per 100k', angle: -90, position: 'insideLeft', offset: -5, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [`${v}`, 'Rate per 100k']} />
                <Bar dataKey="rate" name="Rate per 100k" radius={[4, 4, 0, 0]}>
                  {unionAgeRateData.map((_: any, i: number) => (
                    <Cell key={i} fill={AGE_COLORS[i % AGE_COLORS.length]} />
                  ))}
                  <LabelList dataKey="rate" position="top" style={{ fontSize: 9, fill: '#374151' }} formatter={(v: any) => (v > 0 ? v : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card chart-card">
            <h5>Intersection (2&cap;3) Pattern &mdash; rate per 100k ({selectedRateYear})</h5>
            <ResponsiveContainer width="100%" height={360}>
              <BarChart data={interAgeRateData} margin={{ top: 10, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis label={{ value: 'per 100k', angle: -90, position: 'insideLeft', offset: -5, fontSize: 11 }} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => [`${v}`, 'Rate per 100k']} />
                <Bar dataKey="rate" name="Rate per 100k" radius={[4, 4, 0, 0]}>
                  {interAgeRateData.map((_: any, i: number) => (
                    <Cell key={i} fill={AGE_COLORS[i % AGE_COLORS.length]} />
                  ))}
                  <LabelList dataKey="rate" position="top" style={{ fontSize: 9, fill: '#374151' }} formatter={(v: any) => (v > 0 ? v : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* === Thailand GeoMap by Province === */}
      <div className="comparison-row">
        <h3 className="section-title">Episode Rate per 100,000 Population by Province (Thailand GeoMap)</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
          <label style={{ fontWeight: 600, fontSize: '14px' }}>Year:</label>
          <select
            value={selectedRateYear}
            onChange={e => setSelectedRateYear(parseInt(e.target.value))}
            style={{ fontSize: '14px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', cursor: 'pointer' }}
          >
            {ALL_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {!thailandGeo && (
            <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '8px' }}>Loading map data…</span>
          )}
        </div>
        {thailandGeo ? (
          <div className="comparison-grid">
            <ThailandGeoMap
              rateData={unionProvRateData}
              geoData={thailandGeo}
              title={`Union (2∪3) Pattern — rate per 100k (${selectedRateYear})`}
            />
            <ThailandGeoMap
              rateData={interProvRateData}
              geoData={thailandGeo}
              title={`Intersection (2∩3) Pattern — rate per 100k (${selectedRateYear})`}
            />
          </div>
        ) : (
          <div className="comparison-grid">
            {[0, 1].map(i => (
              <div key={i} className="card chart-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
                <p style={{ color: '#9ca3af' }}>Loading Thailand map data…</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* === Venn Diagram Part 1: by first_diagcode === */}
      <div className="comparison-row">
        <h3 className="section-title">Episode &amp; Drug Overlap — Venn Diagram</h3>
        <h4 style={{ margin: '0 0 1rem 0', color: '#065f46', fontWeight: 700, fontSize: '1rem' }}>Part 1 — by first_diagcode</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '2rem' }}>
          {VENN_CODES.map(code => {
            const v = vennData.first[code];
            if (!v) return (
              <div key={code} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#9ca3af' }}>
                No records for first_diagcode = {code}
              </div>
            );
            return <VennSVG key={code} v={v} diagCode={code} diagType="first_diagcode" />;
          })}
        </div>
      </div>

      {/* === Venn Diagram Part 2: by most_diagcode === */}
      <div className="comparison-row">
        <h4 style={{ margin: '0 0 1rem 0', color: '#1d4ed8', fontWeight: 700, fontSize: '1rem' }}>Part 2 — by most_diagcode</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '2rem' }}>
          {VENN_CODES.map(code => {
            const v = vennData.most[code];
            if (!v) return (
              <div key={code} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#9ca3af' }}>
                No records for most_diagcode = {code}
              </div>
            );
            return <VennSVG key={code} v={v} diagCode={code} diagType="most_diagcode" />;
          })}
        </div>
      </div>
    </div>
  );
}
