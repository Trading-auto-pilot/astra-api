import { useCallback, useEffect, useMemo, useState } from "react";
import "rc-slider/assets/index.css";
import Slider, { Range as RcRange } from "rc-slider";
import SectionHeader from "../molecules/content/SectionHeader";
import { env } from "../../config/env";

type WeightKey = string;
type WeightRecord = Record<WeightKey, number>;

const Range = RcRange || (Slider as any).Range;

const COLOR_PALETTE = ["#2563eb", "#22c55e", "#f97316", "#e11d48", "#8b5cf6"];

const growthKeys: WeightKey[] = ["wt_growth_momentum", "wt_growth_volume", "wt_growth_risk", "wt_growth_market"];
const shortKeys: WeightKey[] = ["wt_short_struct", "wt_short_market"];
const marketKeys: WeightKey[] = ["wt_ms_trend", "wt_ms_regime", "wt_ms_corr_penalty_max"];
const marketRiskKeys: WeightKey[] = ["wt_mr_vol_safe", "wt_mr_dd_safe", "wt_mr_gap_safe", "wt_mr_trend_safe"];
const volumeKeys: WeightKey[] = ["wt_vol_spike", "wt_vol_directional", "wt_vol_efficiency", "wt_vol_range"];
const momentumShortKeys: WeightKey[] = [
  "wt_mom_short_ret",
  "wt_mom_short_trend",
  "wt_mom_short_structure",
  "wt_mom_short_rsi",
];
const momentumLongKeys: WeightKey[] = ["wt_mom_12m", "wt_mom_6m", "wt_mom_3m", "wt_mom_1m", "wt_mom_trend"];
const doubleTopKeys: WeightKey[] = ["wt_doubletop_distance", "wt_doubletop_ma_structure", "wt_doubletop_long_pressure"];

const DEFAULT_WEIGHTS: WeightRecord = {
  wt_growth_momentum: 45,
  wt_growth_volume: 25,
  wt_growth_risk: 15,
  wt_growth_market: 15,
  wt_short_struct: 60,
  wt_short_market: 40,
  wt_ms_trend: 55,
  wt_ms_regime: 35,
  wt_ms_corr_penalty_max: 20,
  wt_mr_vol_safe: 40,
  wt_mr_dd_safe: 30,
  wt_mr_gap_safe: 20,
  wt_mr_trend_safe: 10,
  wt_vol_spike: 40,
  wt_vol_directional: 30,
  wt_vol_efficiency: 20,
  wt_vol_range: 10,
  wt_mom_short_ret: 35,
  wt_mom_short_trend: 30,
  wt_mom_short_structure: 20,
  wt_mom_short_rsi: 15,
  wt_mom_12m: 40,
  wt_mom_6m: 25,
  wt_mom_3m: 20,
  wt_mom_1m: 5,
  wt_mom_trend: 10,
  wt_doubletop_distance: 45,
  wt_doubletop_ma_structure: 35,
  wt_doubletop_long_pressure: 20,
};

const GROUPS: {
  title: string;
  subtitle?: string;
  keys: WeightKey[];
  formula?: string;
}[] = [
  {
    title: "Growth Probability",
    subtitle: "GM, GV, GR, GMk pesano sulla probabilità di crescita a breve.",
    keys: growthKeys,
    formula: "GrowthProb = GM + GV + GR + GMk (somma 100%)",
  },
  {
    title: "ShortRisk combinato",
    subtitle: "Bilancia rischio strutturale (SR) e di mercato (MR).",
    keys: shortKeys,
    formula: "ShortRisk = SR + MR",
  },
  {
    title: "Market score",
    subtitle: "Trend, regime e penalità correlazione.",
    keys: marketKeys,
    formula: "Market = T + R − Pen",
  },
  {
    title: "Market risk score",
    subtitle: "Volatilità, drawdown, gap e trend safety.",
    keys: marketRiskKeys,
  },
  {
    title: "Volume score",
    subtitle: "Spike, direzionalità, efficienza, range.",
    keys: volumeKeys,
  },
  {
    title: "Momentum short (price action)",
    subtitle: "Ritorno breve, trend, struttura, RSI.",
    keys: momentumShortKeys,
  },
  {
    title: "Momentum lungo (12/6/3/1m + trend)",
    subtitle: "Allinea orizzonti multipli e trend.",
    keys: momentumLongKeys,
  },
  {
    title: "Double top",
    subtitle: "Distanza, struttura MA, pressione long.",
    keys: doubleTopKeys,
  },
];

const friendlyLabel = (key: string) =>
  key
    .replace(/^wt_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const shortLabel: Record<string, string> = {
  wt_growth_momentum: "GM",
  wt_growth_volume: "GV",
  wt_growth_risk: "GR",
  wt_growth_market: "GMk",
  wt_short_struct: "SR",
  wt_short_market: "MR",
  wt_ms_trend: "T",
  wt_ms_regime: "R",
  wt_ms_corr_penalty_max: "Pen",
  wt_mr_vol_safe: "Vol",
  wt_mr_dd_safe: "DD",
  wt_mr_gap_safe: "Gap",
  wt_mr_trend_safe: "Trend",
  wt_vol_spike: "Spike",
  wt_vol_directional: "Dir",
  wt_vol_efficiency: "Eff",
  wt_vol_range: "Range",
  wt_mom_short_ret: "Ret",
  wt_mom_short_trend: "Trend",
  wt_mom_short_structure: "Struct",
  wt_mom_short_rsi: "RSI",
  wt_mom_12m: "12m",
  wt_mom_6m: "6m",
  wt_mom_3m: "3m",
  wt_mom_1m: "1m",
  wt_mom_trend: "Trend",
  wt_doubletop_distance: "Dist",
  wt_doubletop_ma_structure: "MA Struct",
  wt_doubletop_long_pressure: "Long press.",
};

const normalizeGroup = (incoming: WeightRecord, keys: WeightKey[]): WeightRecord => {
  const result: WeightRecord = {};
  let values = keys.map((k) => incoming[k]);

  if (values.every((v) => v === undefined || v === null)) {
    keys.forEach((k) => (result[k] = DEFAULT_WEIGHTS[k]));
    return result;
  }

  values = values.map((v, idx) => {
    if (v === null || v === undefined) return DEFAULT_WEIGHTS[keys[idx]];
    return v <= 1 ? v * 100 : v;
  });

  const sum = values.reduce((acc, v) => acc + v, 0);
  const normalized = sum > 0 ? values.map((v) => (v / sum) * 100) : values;
  keys.forEach((k, idx) => {
    result[k] = Number(normalized[idx].toFixed(2));
  });
  return result;
};

export default function UserSettingsPage() {
  const [weights, setWeights] = useState<WeightRecord>({});
  const [userId, setUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const token = useMemo(
    () => (typeof localStorage !== "undefined" ? localStorage.getItem("astraai:auth:token") : null),
    []
  );

  const mergeWeights = useCallback((raw: any) => {
    let next: WeightRecord = {};
    GROUPS.forEach((g) => {
      const normalized = normalizeGroup(raw || {}, g.keys);
      next = { ...next, ...normalized };
    });
    setWeights(next);
  }, []);

  const fetchWeights = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${env.apiBaseUrl}/auth/admin/me`, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const me = await res.json();
      const uid = me?.user?.id || me?.id || me?.tokenPayload?.sub;
      if (!uid) throw new Error("Utente non valido");
      setUserId(Number(uid));

      const scoreWeights =
        me?.scoreWeights || me?.score_weights || me?.user?.scoreWeights || me?.user?.score_weights || me?.weights;
      if (scoreWeights) {
        mergeWeights(scoreWeights);
        return;
      }

      const fallback = await fetch(`${env.apiBaseUrl}/auth/admin/user/${uid}/score-weights`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" },
      });
      if (!fallback.ok) throw new Error(`HTTP ${fallback.status}`);
      const data = await fallback.json();
      mergeWeights(data);
    } catch (err: any) {
      setError(err?.message || "Errore durante il caricamento");
    } finally {
      setLoading(false);
    }
  }, [mergeWeights, token]);

  useEffect(() => {
    fetchWeights();
  }, [fetchWeights]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${env.apiBaseUrl}/auth/admin/user/${userId}/score-weights`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify(weights),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSuccess("Pesi aggiornati con successo");
    } catch (err: any) {
      setError(err?.message || "Errore durante il salvataggio");
    } finally {
      setSaving(false);
    }
  };

  const applyDefaults = () => {
    mergeWeights(DEFAULT_WEIGHTS);
  };

  const weightsToHandles = (keys: WeightKey[]) => {
    const vals = keys.map((k) => weights[k] ?? DEFAULT_WEIGHTS[k]);
    const sum = vals.reduce((a, b) => a + b, 0) || 1;
    const normalized = vals.map((v) => (v / sum) * 100);
    const handles: number[] = [];
    normalized.reduce((acc, v, idx) => {
      if (idx < normalized.length - 1) {
        const cum = acc + v;
        handles.push(Number(cum.toFixed(2)));
        return cum;
      }
      return acc + v;
    }, 0);
    return handles;
  };

  const handlesToWeights = (keys: WeightKey[], handles: number[]) => {
    const points = [0, ...handles, 100];
    const newWeights: WeightRecord = { ...weights };
    keys.forEach((k, idx) => {
      const slice = points[idx + 1] - points[idx];
      newWeights[k] = Number(slice.toFixed(2));
    });
    setWeights(newWeights);
  };

  const renderCard = (title: string, subtitle: string | undefined, keys: WeightKey[], formula?: string) => {
    const handles = weightsToHandles(keys);
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-600">{subtitle}</p>}
            {formula && <p className="mt-1 text-[11px] text-slate-500">{formula}</p>}
          </div>
        </div>
        {Range && (
          <Range
            value={handles}
            min={0}
            max={100}
            step={0.5}
            onChange={(vals: number[]) => handlesToWeights(keys, vals)}
            allowCross={false}
            pushable={1}
            trackStyle={handles.map((_, idx) => ({
              backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
              height: 6,
            }))}
            handleStyle={handles.map((_, idx) => ({
              borderColor: COLOR_PALETTE[idx % COLOR_PALETTE.length],
              backgroundColor: "#fff",
              height: 18,
              width: 18,
            }))}
            railStyle={{ backgroundColor: "#e2e8f0", height: 6 }}
          />
        )}
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
          {keys.map((k, idx) => {
            const value = weights[k] ?? DEFAULT_WEIGHTS[k];
            return (
              <div key={k} className="flex items-center justify-between rounded-lg border border-slate-100 px-2 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: COLOR_PALETTE[idx % COLOR_PALETTE.length] }}
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="font-semibold text-slate-800">{shortLabel[k] || friendlyLabel(k)}</span>
                    <span className="text-[11px] text-slate-500">{friendlyLabel(k)}</span>
                  </div>
                </div>
                <span className="font-semibold text-slate-800">{value?.toFixed(2)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <SectionHeader title="User Settings" subTitle="Configura i pesi personalizzati degli score" />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={fetchWeights}
            disabled={loading}
          >
            {loading ? "Reloading..." : "Reload"}
          </button>
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={applyDefaults}
          >
            Set default
          </button>
        </div>
        <button
          type="button"
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
          onClick={handleSave}
          disabled={saving || loading}
        >
          {saving ? "Salvataggio..." : "Save"}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {GROUPS.map((g) => (
          <div key={g.title}>{renderCard(g.title, g.subtitle, g.keys, g.formula)}</div>
        ))}
      </div>
    </div>
  );
}
