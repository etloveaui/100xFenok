# Damodaran shadow converter snapshot

This directory is an exact platform-side snapshot of the CCH Damodaran
converter used only by the shadow parity producer. It does not own or publish
`data/damodaran/**`.

- Source: `claude-code-hub/docs/products/converters/damodaran/`
- Source repository commit: `1c16acfb5b6f1cfb89aef92accc899f6e7b4deac`
- Snapshot scope: `config.py`, `run.py`, `base/`, `parsers/`, `requirements.txt`
- Platform adapter: `produce_bundle.py`

Update this snapshot mechanically from the CCH source before changing parser
behavior. Parity comparisons intentionally ignore only
`metadata.generated_at`.
