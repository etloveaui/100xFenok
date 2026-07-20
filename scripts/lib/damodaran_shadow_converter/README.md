# Damodaran shadow converter snapshot

This directory is the platform-owned snapshot of the proven CCH Damodaran
converter. The weekly platform producer uses it to publish `data/damodaran/**`
and the public mirror behind a permanent fail-closed output guard.

- Source: `claude-code-hub/docs/products/converters/damodaran/`
- Source repository commit: `1c16acfb5b6f1cfb89aef92accc899f6e7b4deac`
- Snapshot scope: `config.py`, `run.py`, `base/`, `parsers/`, `requirements.txt`
- Platform adapter: `produce_bundle.py`

Update this snapshot mechanically from the CCH source before changing parser
behavior. The owner guard compares the producer bundle with all six generated
files exactly before canonical promotion; the workflow then verifies canonical
and public-mirror tree parity before committing.
