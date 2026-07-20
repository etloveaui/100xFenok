#!/usr/bin/env bash

set -uo pipefail

workflow=""
ref=""
attempts="3"
delay_seconds="5"

usage() {
  echo "usage: $0 --workflow FILE --ref REF [--attempts 1-5] [--delay-seconds 0-60]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --workflow|--ref|--attempts|--delay-seconds)
      if [ "$#" -lt 2 ]; then
        usage
        exit 2
      fi
      case "$1" in
        --workflow) workflow="$2" ;;
        --ref) ref="$2" ;;
        --attempts) attempts="$2" ;;
        --delay-seconds) delay_seconds="$2" ;;
      esac
      shift 2
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ ! "$workflow" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$ ]]; then
  echo "dispatch retry: invalid workflow file" >&2
  exit 2
fi
if [[ ! "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || [[ "$ref" == /* ]] || [[ "$ref" == *..* ]]; then
  echo "dispatch retry: invalid ref" >&2
  exit 2
fi
if [[ ! "$attempts" =~ ^[0-9]+$ ]] || [ "$attempts" -lt 1 ] || [ "$attempts" -gt 5 ]; then
  echo "dispatch retry: attempts must be an integer from 1 through 5" >&2
  exit 2
fi
if [[ ! "$delay_seconds" =~ ^[0-9]+$ ]] || [ "$delay_seconds" -gt 60 ]; then
  echo "dispatch retry: delay-seconds must be an integer from 0 through 60" >&2
  exit 2
fi

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if gh workflow run "$workflow" --ref "$ref"; then
    echo "Worker deploy dispatch succeeded on attempt ${attempt}/${attempts}"
    exit 0
  fi
  if [ "$attempt" -lt "$attempts" ]; then
    echo "::warning::Worker deploy dispatch failed on attempt ${attempt}/${attempts}; retrying in ${delay_seconds}s"
    if [ "$delay_seconds" -gt 0 ]; then sleep "$delay_seconds"; fi
  fi
done

echo "::warning::Worker deploy dispatch failed after ${attempts} attempts; generated data is already committed and the scheduled deploy remains the safety net"
exit 0
