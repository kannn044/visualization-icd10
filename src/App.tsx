import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  Cell, LabelList, PieChart, Pie, Legend
} from 'recharts';

interface EpisodeData {
  id: string;
  episode: number;
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

export default function App() {
  const [rawData, setRawData] = useState<EpisodeData[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [viewType, setViewType] = useState<'most_diagcode' | 'first_diagcode' | 'diag2'>('most_diagcode');
  const [diagFilter, setDiagFilter] = useState('All');
  const [genderFilter, setGenderFilter] = useState({ all: true, male: false, female: false });
  const [zoneFilter, setZoneFilter] = useState('All');

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
    AGE_LABELS.forEach(l => ageStats[l] = { male: 0, female: 0, total: 0 });
    data.forEach(d => {
      if (!ageSeen.has(d.id)) {
        const bin = getAgeBin(d.age_at_episode_start);
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
      age: AGE_LABELS.map(name => ({ name, ...ageStats[name] })),
      zone: Object.entries(zoneStats).map(([name, val]: any) => ({ name, ...val })).sort((a,b) => parseInt(a.name) - parseInt(b.name)),
      province: Object.entries(provStats).map(([name, val]: any) => ({ name, ...val })).sort((a,b) => b.total - a.total).slice(0, 10)
    };
  };

  const unionStats = useMemo(() => getStats(unionData), [unionData]);
  const interStats = useMemo(() => getStats(interData), [interData]);

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
    </div>
  );
}
