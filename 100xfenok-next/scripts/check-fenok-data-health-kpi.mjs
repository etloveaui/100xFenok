#!/usr/bin/env node
import { executeCheckerRun } from "../../scripts/check-fenok-data-health-kpi.mjs";

const result = executeCheckerRun();
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
if (result.exit !== 0) process.exit(result.exit);
