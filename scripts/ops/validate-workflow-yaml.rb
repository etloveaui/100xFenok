#!/usr/bin/env ruby
# Validate GitHub workflow YAML syntax before GitHub Actions reaches job creation.

require "yaml"

paths = ARGV.empty? ? Dir.glob(".github/workflows/*.{yml,yaml}").sort : ARGV
failed = []

paths.each do |path|
  begin
    YAML.parse_file(path)
    puts "PASS #{path}"
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

puts "Validated #{paths.length} workflow YAML file(s)."
