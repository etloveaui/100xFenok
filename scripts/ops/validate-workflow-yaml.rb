#!/usr/bin/env ruby
# Validate GitHub workflow YAML syntax before GitHub Actions reaches job creation.

require "yaml"

paths = ARGV.empty? ? Dir.glob(".github/workflows/*.{yml,yaml}").sort : ARGV
failed = []
schema_failed = []

# GitHub Actions defines exactly two keys under `concurrency`. It ignores the
# rest silently, so an invented key reads as configuration while doing nothing.
# `queue: max` sat in 28 workflows and was read by humans as a deep writer
# queue; the real behaviour is one run in progress plus at most ONE waiting, and
# a third arrival cancels the waiter. Two acquisition slots died that way on
# 2026-07-24 before anyone noticed. Syntax validation cannot catch this - the
# YAML is perfectly well-formed - which is the same blind spot as #357, where a
# file GitHub itself refused to run passed this check.
CONCURRENCY_KEYS = %w[group cancel-in-progress].freeze

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
    next if unknown.empty?
    found << "#{path}: #{where} concurrency declares #{unknown.join(', ')} - GitHub Actions defines only #{CONCURRENCY_KEYS.join(', ')} and silently ignores anything else"
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
