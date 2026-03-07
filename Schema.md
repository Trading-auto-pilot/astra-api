


                ┌────────────────────┐
                │  Data Provider(s)  │  (Alpaca/IBKR/FMP/Polygon...)
                └─────────┬──────────┘
                          │ OHLCV / Corporate actions / Spreads
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                         CacheManager                            │
│  - caching candles / quote / corporate actions                   │
│  - data quality flags (missing, gaps, outliers)                  │
└─────────┬───────────────────────────────────────────┬───────────┘
          │                                           │
          ▼                                           ▼
┌──────────────────────┐                     ┌──────────────────────┐
│      DBManager        │                     │   Market Regime Svc   │
│  - persiste raw data  │                     │  - SPY/IWM/QQQ regime  │
│  - persiste snapshots │                     │  - risk-on / risk-off  │
└─────────┬────────────┘                     └─────────┬────────────┘
          │                                           │
          ▼                                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                         TickerScanner                           │
│  Step 1-6: Universe → Features → Candidates → Signals + TradePlan │
│  - produce snapshot tables + symbol_state                         │
└─────────┬───────────────────────────────────────────┬───────────┘
          │ Signals + TradePlan                         │ Monitoring
          ▼                                             ▼
┌──────────────────────┐                     ┌──────────────────────┐
│   PortfolioManager    │                     │    AlertingService    │
│  - Risk checks (9)    │                     │  - alerts + catalogo   │
│  - Position/Exit (8)  │                     │  - errors/kill switch  │
│  - decides approvals  │                     └──────────────────────┘
└─────────┬────────────┘
          │ Approved Orders / Updates
          ▼
┌──────────────────────┐
│    ExecutionEngine    │  (7)
│  - submit/modify/cancel
│  - idempotency + retries
│  - listens fills/events
└─────────┬────────────┘
          ▼
     ┌───────────┐
     │   Broker  │
     └───────────┘



     