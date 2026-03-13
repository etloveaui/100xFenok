#!/bin/bash
#
# CSV Conversion Pipeline for Stock Analyzer Global Expansion
# Automates the process of converting Global Scouter CSV files to JSON
#
# Usage: ./csv_pipeline.sh [options]
# Options:
#   -i, --input DIR      Input directory containing CSV files (default: ../data/csv)
#   -o, --output DIR     Output directory for JSON files (default: ../data)
#   -c, --config FILE    Configuration file (default: ../config/csv_config.json)
#   -b, --batch          Run in batch mode (convert all CSV files)
#   -w, --watch          Watch mode (auto-convert on file changes)
#   -t, --test           Run conversion tests
#   -h, --help           Show this help message

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INPUT_DIR="$PROJECT_ROOT/data/csv"
OUTPUT_DIR="$PROJECT_ROOT/data"
CONFIG_FILE="$PROJECT_ROOT/config/csv_config.json"
PYTHON_SCRIPT="$PROJECT_ROOT/tools/csv_to_json_converter.py"

# Pipeline settings
BATCH_MODE=false
WATCH_MODE=false
TEST_MODE=false

# Log file
LOG_FILE="$PROJECT_ROOT/logs/csv_pipeline_$(date +%Y%m%d_%H%M%S).log"

# Function to print colored output
print_color() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to log messages
log() {
    local message="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "$message" >> "$LOG_FILE"
    echo "$message"
}

# Function to check dependencies
check_dependencies() {
    print_color "$BLUE" "Checking dependencies..."

    # Check Python
    if ! command -v python3 &> /dev/null; then
        print_color "$RED" "Error: Python 3 is not installed"
        exit 1
    fi

    # Check if converter script exists
    if [ ! -f "$PYTHON_SCRIPT" ]; then
        print_color "$RED" "Error: Converter script not found at $PYTHON_SCRIPT"
        exit 1
    fi

    # Check/create directories
    mkdir -p "$INPUT_DIR" "$OUTPUT_DIR" "$(dirname "$LOG_FILE")"

    print_color "$GREEN" "✓ Dependencies checked"
}

# Function to convert single CSV file
convert_file() {
    local csv_file=$1
    local json_file="${OUTPUT_DIR}/$(basename "${csv_file%.*}.json")"

    log "Converting $csv_file to $json_file"

    # Run Python converter
    if python3 "$PYTHON_SCRIPT" "$csv_file" -o "$json_file" -c "$CONFIG_FILE" 2>&1 | tee -a "$LOG_FILE"; then
        print_color "$GREEN" "✓ Successfully converted $(basename "$csv_file")"
        return 0
    else
        print_color "$RED" "✗ Failed to convert $(basename "$csv_file")"
        return 1
    fi
}

# Function to run batch conversion
batch_convert() {
    print_color "$BLUE" "Running batch conversion..."

    local total=0
    local success=0
    local failed=0

    # Find all CSV files
    for csv_file in "$INPUT_DIR"/*.csv; do
        if [ -f "$csv_file" ]; then
            total=$((total + 1))
            if convert_file "$csv_file"; then
                success=$((success + 1))
            else
                failed=$((failed + 1))
            fi
        fi
    done

    # Print summary
    echo ""
    print_color "$BLUE" "Batch Conversion Summary:"
    print_color "$GREEN" "  Total files: $total"
    print_color "$GREEN" "  Successful: $success"
    if [ $failed -gt 0 ]; then
        print_color "$RED" "  Failed: $failed"
    fi

    # Generate quality report
    generate_quality_report
}

# Function to watch for file changes
watch_files() {
    print_color "$BLUE" "Starting watch mode..."
    print_color "$YELLOW" "Watching $INPUT_DIR for changes. Press Ctrl+C to stop."

    # Use inotifywait if available
    if command -v inotifywait &> /dev/null; then
        while true; do
            inotifywait -q -e modify,create "$INPUT_DIR"/*.csv
            file=$(inotifywait -q -e modify,create --format '%w%f' "$INPUT_DIR"/*.csv)
            print_color "$YELLOW" "File changed: $file"
            convert_file "$file"
        done
    else
        # Fallback to polling
        declare -A file_times

        while true; do
            for csv_file in "$INPUT_DIR"/*.csv; do
                if [ -f "$csv_file" ]; then
                    current_time=$(stat -c %Y "$csv_file" 2>/dev/null || stat -f %m "$csv_file")

                    if [ "${file_times[$csv_file]}" != "$current_time" ]; then
                        file_times[$csv_file]=$current_time
                        print_color "$YELLOW" "File changed: $(basename "$csv_file")"
                        convert_file "$csv_file"
                    fi
                fi
            done
            sleep 2
        done
    fi
}

# Function to run conversion tests
run_tests() {
    print_color "$BLUE" "Running conversion tests..."

    # Create test CSV
    local test_csv="$INPUT_DIR/test_data.csv"
    cat > "$test_csv" << EOF
Ticker,종목명,Price,PER (Oct-25),PBR (Oct-25),ROE (Fwd),시가총액 (\$M),YTD
AAPL,Apple Inc.,150.00,25.5,35.2,45.8,2500000,15.5
MSFT,Microsoft Corp.,300.00,30.2,12.5,38.2,2200000,22.3
GOOGL,Alphabet Inc.,2800.00,28.5,6.8,25.6,1800000,35.2
EOF

    # Convert test file
    if convert_file "$test_csv"; then
        local json_file="$OUTPUT_DIR/test_data.json"

        # Verify JSON structure
        if python3 -c "import json; json.load(open('$json_file'))" 2>/dev/null; then
            print_color "$GREEN" "✓ JSON structure valid"

            # Check for expected fields
            local record_count=$(python3 -c "import json; data=json.load(open('$json_file')); print(len(data['data']))")

            if [ "$record_count" -eq "3" ]; then
                print_color "$GREEN" "✓ Correct number of records"
            else
                print_color "$RED" "✗ Unexpected record count: $record_count"
            fi
        else
            print_color "$RED" "✗ Invalid JSON structure"
        fi

        # Cleanup test files
        rm -f "$test_csv" "$json_file"
    else
        print_color "$RED" "✗ Test conversion failed"
    fi
}

# Function to generate quality report
generate_quality_report() {
    print_color "$BLUE" "Generating quality report..."

    local report_file="$PROJECT_ROOT/reports/conversion_quality_$(date +%Y%m%d_%H%M%S).json"
    mkdir -p "$(dirname "$report_file")"

    # Run Python script to generate comprehensive report
    python3 << EOF > "$report_file"
import json
import os
from pathlib import Path

output_dir = "$OUTPUT_DIR"
report_data = {
    "timestamp": "$(date -Iseconds)",
    "files_processed": [],
    "overall_quality": {},
    "issues": []
}

for json_file in Path(output_dir).glob("*.json"):
    try:
        with open(json_file, 'r') as f:
            data = json.load(f)

            file_info = {
                "file": str(json_file.name),
                "record_count": len(data.get("data", [])),
                "quality": data.get("metadata", {}).get("qualityMetrics", {})
            }
            report_data["files_processed"].append(file_info)

            # Check for issues
            if file_info["record_count"] == 0:
                report_data["issues"].append(f"{json_file.name}: No records found")

            quality = file_info.get("quality", {})
            if quality.get("completeness", 100) < 80:
                report_data["issues"].append(f"{json_file.name}: Low completeness ({quality.get('completeness', 0)}%)")

    except Exception as e:
        report_data["issues"].append(f"{json_file.name}: {str(e)}")

# Calculate overall metrics
if report_data["files_processed"]:
    total_records = sum(f["record_count"] for f in report_data["files_processed"])
    avg_completeness = sum(
        f["quality"].get("completeness", 0)
        for f in report_data["files_processed"]
    ) / len(report_data["files_processed"])

    report_data["overall_quality"] = {
        "total_files": len(report_data["files_processed"]),
        "total_records": total_records,
        "average_completeness": round(avg_completeness, 2),
        "issues_count": len(report_data["issues"])
    }

print(json.dumps(report_data, indent=2))
EOF

    if [ -f "$report_file" ]; then
        print_color "$GREEN" "✓ Quality report generated: $report_file"

        # Display summary
        python3 -c "
import json
with open('$report_file') as f:
    data = json.load(f)
    quality = data.get('overall_quality', {})
    print(f\"  Total files: {quality.get('total_files', 0)}\")
    print(f\"  Total records: {quality.get('total_records', 0)}\")
    print(f\"  Average completeness: {quality.get('average_completeness', 0)}%\")
    print(f\"  Issues found: {quality.get('issues_count', 0)}\")
"
    fi
}

# Function to show help
show_help() {
    cat << EOF
CSV Conversion Pipeline for Stock Analyzer Global Expansion

Usage: $0 [options]

Options:
  -i, --input DIR      Input directory containing CSV files (default: $INPUT_DIR)
  -o, --output DIR     Output directory for JSON files (default: $OUTPUT_DIR)
  -c, --config FILE    Configuration file (default: $CONFIG_FILE)
  -b, --batch          Run in batch mode (convert all CSV files)
  -w, --watch          Watch mode (auto-convert on file changes)
  -t, --test           Run conversion tests
  -h, --help           Show this help message

Examples:
  # Convert all CSV files in batch
  $0 --batch

  # Watch for changes and auto-convert
  $0 --watch

  # Use custom directories
  $0 --input /path/to/csv --output /path/to/json --batch

  # Run tests
  $0 --test

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--input)
            INPUT_DIR="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -c|--config)
            CONFIG_FILE="$2"
            shift 2
            ;;
        -b|--batch)
            BATCH_MODE=true
            shift
            ;;
        -w|--watch)
            WATCH_MODE=true
            shift
            ;;
        -t|--test)
            TEST_MODE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_color "$RED" "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Main execution
main() {
    print_color "$BLUE" "═══════════════════════════════════════════"
    print_color "$BLUE" " CSV Conversion Pipeline"
    print_color "$BLUE" "═══════════════════════════════════════════"
    echo ""

    # Check dependencies
    check_dependencies

    # Create log entry
    log "Pipeline started with INPUT_DIR=$INPUT_DIR, OUTPUT_DIR=$OUTPUT_DIR"

    # Execute based on mode
    if [ "$TEST_MODE" = true ]; then
        run_tests
    elif [ "$BATCH_MODE" = true ]; then
        batch_convert
    elif [ "$WATCH_MODE" = true ]; then
        watch_files
    else
        # Default: convert any new/modified files
        print_color "$YELLOW" "No mode specified. Running batch conversion..."
        batch_convert
    fi

    log "Pipeline completed"
    print_color "$GREEN" "✓ Pipeline completed. Check logs at: $LOG_FILE"
}

# Run main function
main