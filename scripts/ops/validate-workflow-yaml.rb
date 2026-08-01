#!/usr/bin/env ruby
# Validate GitHub workflow YAML syntax before GitHub Actions reaches job creation.

require "yaml"

paths = ARGV.empty? ? Dir.glob(".github/workflows/*.{yml,yaml}").sort : ARGV
failed = []
schema_failed = []

# GitHub Actions supports a native pending queue under `concurrency`: `single`
# (the replacement-prone default) or `max` (up to 100 pending runs). Keep this
# local schema aligned with GitHub while still rejecting invented keys and the
# forbidden max-queue + in-progress-cancellation combination.
CONCURRENCY_KEYS = %w[group cancel-in-progress queue].freeze
CONCURRENCY_QUEUE_VALUES = %w[single max].freeze

def concurrency_violations(doc, path)
  found = []
  blocks = []
  blocks << ["top-level", doc["concurrency"]] if doc.is_a?(Hash)
  jobs = doc.is_a?(Hash) ? doc["jobs"] : nil
  if jobs.is_a?(Hash)
    jobs.each { |name, job| blocks << ["job #{name}", job["concurrency"]] if job.is_a?(Hash) }
  end
  blocks.each do |where, block|
    next unless block.is_a?(Hash)
    unknown = block.keys.map(&:to_s) - CONCURRENCY_KEYS
    unless unknown.empty?
      found << "#{path}: #{where} concurrency declares #{unknown.join(', ')} - GitHub Actions defines only #{CONCURRENCY_KEYS.join(', ')}"
    end
    queue = block["queue"]
    if !queue.nil? && !CONCURRENCY_QUEUE_VALUES.include?(queue.to_s)
      found << "#{path}: #{where} concurrency queue must be one of #{CONCURRENCY_QUEUE_VALUES.join(', ')}"
    end
    if queue.to_s == "max" && block["cancel-in-progress"] == true
      found << "#{path}: #{where} concurrency queue max is incompatible with cancel-in-progress true"
    end
  end
  found
end

paths.each do |path|
  begin
    YAML.parse_file(path)
    # Ruby >= 3.1 refuses YAML aliases unless asked; Ruby 2.6 does not know the
    # keyword at all. Support both so the guard runs on a developer machine and
    # on the runner rather than only where it happened to be written.
    doc = begin
      YAML.load_file(path, aliases: true)
    rescue ArgumentError
      YAML.load_file(path)
    end
    violations = concurrency_violations(doc, path)
    if violations.empty?
      puts "PASS #{path}"
    else
      schema_failed.concat(violations)
      violations.each { |line| warn "FAIL #{line}" }
    end
  rescue Psych::SyntaxError => error
    failed << [path, error]
    warn "FAIL #{path}: #{error.message}"
  end
end

if failed.any?
  warn "\nWorkflow YAML syntax failures: #{failed.length}"
  failed.each do |path, error|
    warn "- #{path}: line #{error.line}, column #{error.column}"
  end
  exit 1
end

if schema_failed.any?
  warn "\nWorkflow concurrency schema failures: #{schema_failed.length}"
  schema_failed.each { |line| warn "- #{line}" }
  exit 1
end

puts "Validated #{paths.length} workflow YAML file(s)."
