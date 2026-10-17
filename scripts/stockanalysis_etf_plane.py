#!/usr/bin/env python3
"""Build the selected ETF plane bundle without changing the source checkout."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import subprocess

from data_supply_state import DataSupplyStateStore, canonical_sha256, deterministic_event_id
from materialize_data_supply_public import PublicDataSupplyMaterializer
from stockanalysis_etf_lifecycle import select_detail_universe

STATE = Path('data/admin/data-supply-state/v1')
SELECTION = STATE / 'etf-detail-selection.json'


def read(path, fallback=None):
    return json.loads(path.read_text()) if path.is_file() else fallback


def select(root, owner, prior_selected=None):
    universe = read(root / 'data/stockanalysis/etf_universe.json', {})
    prior = read(root / SELECTION, {})
    stocks = read(root / 'data/global-scouter/core/stocks_analyzer.json', {}).get('data', [])
    stocks += [{'symbol': name.removesuffix('.json')} for name in
               read(root / 'data/yf/finance/_index.json', {})]
    prior_selected = prior.get('selected', []) if prior_selected is None else prior_selected
    result = select_detail_universe(universe.get('records', []), prior_selected=prior_selected,
                                    always_include=owner, stock_records=stocks)
    result['owner_tickers'] = sorted(set(owner) & set(result['selected']))
    result['prior_selected'] = sorted(prior_selected)
    return result


def copy(source, target):
    if source.is_symlink() or not source.is_file():
        raise ValueError(f'not a regular input: {source}')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)


def retain_recovery(source, target, selected):
    for branch in ('states/etf', 'lkg/etf'):
        prefix = Path('data/admin/stockanalysis-recovery') / branch
        for ticker in selected:
            rel = prefix / f'{ticker}.json'
            if (source / rel).is_file():
                copy(source / rel, target / rel)
    fallback = source / 'data/admin/yahoo_etf_fallback'
    for file in fallback.rglob('*.json') if fallback.exists() else []:
        value = read(file, {})
        # The legacy fallback index is metadata; per-ticker payloads stay scoped.
        if file.name == 'index.json' or value.get('ticker') in selected:
            copy(file, target / file.relative_to(source))


def build(source, target, selection):
    if target.exists():
        raise ValueError('bundle output must not already exist')
    selected = set(selection['selected'])
    if not selected:
        raise ValueError('empty ETF selection')
    source_store = DataSupplyStateStore(source / STATE, defer_maintenance=True)
    active = source_store.read_active_domain('etf_detail')
    if active['transaction_id'] is None:
        raise ValueError('ETF provider selection state is absent')
    target.mkdir(parents=True)
    retain_recovery(source, target, selected)
    # Keep provider history for the selected set. Alias paths resolve to the same
    # content-addressed R2 objects; no second payload is uploaded for an alias.
    for ticker in sorted(selected):
        for prefix in ('data/stockanalysis/etfs', 'data/yf/etf-details'):
            rel = Path(prefix) / f'{ticker}.json'
            if (source / rel).is_file():
                copy(source / rel, target / rel)
    for source_path in sorted((source / STATE / 'providers').rglob('*')):
        if not source_path.is_file() or source_path.is_symlink():
            continue
        rel = source_path.relative_to(source / STATE)
        parts = rel.parts
        if 'etf_detail' not in parts or not (selected.intersection(parts) or source_path.stem in selected):
            continue
        if '.locks' in parts or source_path.name.endswith('.lock'):
            continue
        copy(source_path, target / STATE / rel)
    for ticker in sorted(selected):
        for source_path in sorted((source / STATE / 'partial_candidates' / ticker).glob('*.json')):
            copy(source_path, target / source_path.relative_to(source))
    for source_path in sorted((source / STATE).rglob('*.jsonl')):
        # History is non-derivable; retain selected ETF events, not discarded payloads.
        lines = []
        for line in source_path.read_text().splitlines():
            if not line.strip():
                continue
            event = json.loads(line)
            if event.get('domain') == 'etf_detail' and event.get('entity') in selected:
                lines.append(line)
        if lines:
            output = target / STATE / source_path.relative_to(source / STATE)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text('\n'.join(lines) + '\n')
    # Rebase a selected-only snapshot, retaining provider choices and clocks.
    # The original full state and the previous cloud generation remain untouched.
    store = DataSupplyStateStore(target / STATE, defer_maintenance=True)
    current = {k: v for k, v in active['current'].items() if k in selected}
    lkg = {k: v for k, v in active['lkg'].items() if k in selected}
    recovery = {k: v for k, v in active['recovery'].items() if k in selected}
    for ticker in selected - recovery.keys():
        recovery[ticker] = {'last_transition': 'unavailable'}
    now = datetime.now(timezone.utc)
    decision = {'schema_version': 'data-supply-resolution-event/v1', 'domain': 'etf_detail',
                'entity': 'selection', 'decided_at': now.isoformat(),
                'candidate_event_ids': [], 'evidence_event_ids': [],
                'previous_selection_digest': canonical_sha256({}),
                'new_selection_digest': canonical_sha256(current),
                'transition': 'selected_universe_snapshot', 'reason_code': 'owner_selected_universe'}
    decision['event_id'] = deterministic_event_id('resolution', decision)
    transaction = store._write_prepared_generation_unlocked(
        domain='etf_detail', current=current, lkg=lkg, recovery=recovery,
        decision=decision, active=store._empty_domain(), now=now)
    store.commit_prepared('etf_detail', transaction)
    (target / SELECTION).write_text(json.dumps(selection, sort_keys=True) + '\n')
    # The materializer reads these existing metadata inputs, but they do not
    # belong to the detail bundle and are not enrolled by its publisher.
    for rel in ('data/admin/data-usage-manifest.json', 'data/stockanalysis/etf_universe.json',
                'data/stockanalysis/surfaces/etf_screener.json', 'data/admin/fenok-etf-core-daily-basket.json'):
        if (source / rel).is_file():
            copy(source / rel, target / rel)
    materializer = PublicDataSupplyMaterializer(repo_root=target, require_git_tracking=False)
    result = materializer.write_canonical(generated_at=now.isoformat(), bootstrap_enrollment=True)
    return {'selection': selection['counts'], 'projection': result['counts']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--output-root', type=Path)
    parser.add_argument('--select-only', action='store_true')
    args = parser.parse_args()
    source = args.source_root.resolve()
    existing = read(source / SELECTION)
    if not args.select_only and isinstance(existing, dict) and existing.get('schema_version') == 'etf-detail-selection/v1':
        selection = existing
    else:
        # API output stays in memory; owner values never reach workflow logs.
        owner = json.loads(subprocess.check_output([
            'gh', 'api', 'repos/etloveaui/100xFenok/actions/variables/ETF_ALWAYS_INCLUDE']))['value'].split()
        selection = select(source, owner)
    if args.select_only:
        path = source / SELECTION
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(selection, sort_keys=True) + '\n')
        print(json.dumps({'selection': selection['counts'], 'rotation_days': selection['rotation_interval_days']}))
    else:
        if args.output_root is None:
            parser.error('--output-root is required')
        print(json.dumps(build(source, args.output_root.resolve(), selection)))


if __name__ == '__main__':
    main()
