# 미야코지마 웹 플랫폼 - 완전한 QA 테스트 스위트 실행기
# PowerShell 스크립트 (Windows 환경 최적화)

param(
    [string]$Phase = "all",          # phase1, phase2, phase3, phase4, all
    [string]$Browser = "chromium",   # chromium, firefox, webkit, all
    [switch]$Performance = $false,   # 성능 테스트 실행 여부
    [switch]$Mobile = $false,        # 모바일 테스트 실행 여부
    [switch]$Headless = $true,       # 헤드리스 모드
    [switch]$Report = $true,         # 리포트 생성
    [string]$ServerPort = "3000"     # 로컬 서버 포트
)

# 스크립트 설정
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# 색상 출력 함수
function Write-ColorOutput {
    param($ForegroundColor, $Message)
    Write-Host $Message -ForegroundColor $ForegroundColor
}

function Write-Success { Write-ColorOutput Green $args[0] }
function Write-Warning { Write-ColorOutput Yellow $args[0] }
function Write-Error { Write-ColorOutput Red $args[0] }
function Write-Info { Write-ColorOutput Cyan $args[0] }

# 헤더 출력
Write-Host "=" * 80 -ForegroundColor Magenta
Write-Host "🏝️  미야코지마 웹 플랫폼 - 완전한 QA 테스트 스위트" -ForegroundColor Magenta
Write-Host "=" * 80 -ForegroundColor Magenta
Write-Host ""

# 매개변수 출력
Write-Info "📋 테스트 설정:"
Write-Host "   • Phase: $Phase"
Write-Host "   • Browser: $Browser" 
Write-Host "   • Performance Test: $Performance"
Write-Host "   • Mobile Test: $Mobile"
Write-Host "   • Headless: $Headless"
Write-Host "   • Server Port: $ServerPort"
Write-Host ""

# 전역 변수
$global:TestResults = @{
    StartTime = Get-Date
    TotalTests = 0
    PassedTests = 0
    FailedTests = 0
    Errors = @()
    Phases = @{}
}

# 오류 처리 함수
function Handle-Error {
    param($ErrorMessage, $Exception = $null)
    
    Write-Error "❌ $ErrorMessage"
    if ($Exception) {
        Write-Host "상세 오류: $($Exception.Message)" -ForegroundColor Red
    }
    
    $global:TestResults.Errors += @{
        Message = $ErrorMessage
        Exception = $Exception?.Message
        Time = Get-Date
    }
}

# 사전 검증 함수
function Test-Prerequisites {
    Write-Info "🔍 사전 요구사항 검증 중..."
    
    try {
        # Node.js 확인
        $nodeVersion = node --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "Node.js가 설치되지 않았습니다."
        }
        Write-Success "✅ Node.js: $nodeVersion"
        
        # npm 확인
        $npmVersion = npm --version 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "npm이 설치되지 않았습니다."
        }
        Write-Success "✅ npm: v$npmVersion"
        
        # Playwright 확인
        if (!(Test-Path "node_modules\.bin\playwright.cmd")) {
            Write-Warning "⚠️ Playwright가 설치되지 않았습니다. 설치 중..."
            npm install playwright
            if ($LASTEXITCODE -ne 0) {
                throw "Playwright 설치 실패"
            }
        }
        Write-Success "✅ Playwright 확인됨"
        
        # 프로젝트 파일 확인
        $requiredFiles = @(
            "index.html",
            "js\poi.js", 
            "data\miyakojima_pois.json",
            "sw.js"
        )
        
        foreach ($file in $requiredFiles) {
            if (!(Test-Path $file)) {
                throw "필수 파일이 없습니다: $file"
            }
        }
        Write-Success "✅ 프로젝트 파일 확인 완료"
        
        # 테스트 디렉토리 생성
        $testDirs = @("tests\reports", "tests\screenshots", "tests\logs")
        foreach ($dir in $testDirs) {
            if (!(Test-Path $dir)) {
                New-Item -ItemType Directory -Path $dir -Force | Out-Null
            }
        }
        Write-Success "✅ 테스트 디렉토리 준비 완료"
        
    } catch {
        Handle-Error "사전 요구사항 검증 실패" $_
        return $false
    }
    
    return $true
}

# 로컬 서버 시작 함수
function Start-LocalServer {
    Write-Info "🚀 로컬 서버 시작 중... (포트: $ServerPort)"
    
    try {
        # http-server 설치 확인
        $httpServer = Get-Command http-server -ErrorAction SilentlyContinue
        if (!$httpServer) {
            Write-Warning "⚠️ http-server가 설치되지 않았습니다. 설치 중..."
            npm install -g http-server
            if ($LASTEXITCODE -ne 0) {
                throw "http-server 설치 실패"
            }
        }
        
        # 기존 서버 프로세스 종료
        Get-Process -Name "node" -ErrorAction SilentlyContinue | Where-Object {
            $_.MainWindowTitle -like "*http-server*" -or 
            $_.CommandLine -like "*http-server*"
        } | Stop-Process -Force
        
        # 서버 시작
        $serverJob = Start-Job -ScriptBlock {
            param($port)
            http-server -p $port -c-1 --cors
        } -ArgumentList $ServerPort
        
        # 서버 시작 대기
        Start-Sleep -Seconds 3
        
        # 서버 응답 확인
        $response = Invoke-WebRequest -Uri "http://localhost:$ServerPort" -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Success "✅ 로컬 서버 시작됨: http://localhost:$ServerPort"
            return $serverJob
        } else {
            throw "서버 응답 오류: $($response.StatusCode)"
        }
        
    } catch {
        Handle-Error "로컬 서버 시작 실패" $_
        return $null
    }
}

# Phase별 테스트 실행 함수
function Run-PhaseTests {
    param($PhaseName, $TestSpecs)
    
    Write-Info "📊 $PhaseName 테스트 실행 중..."
    
    $phaseResults = @{
        Name = $PhaseName
        StartTime = Get-Date
        Tests = @()
        Success = $true
    }
    
    foreach ($spec in $TestSpecs) {
        try {
            Write-Host "  🧪 $spec 테스트..." -ForegroundColor White
            
            $testArgs = @(
                "test",
                $spec,
                "--reporter=json",
                "--output-dir=tests\reports"
            )
            
            if ($Headless) {
                $testArgs += "--headed=$false"
            }
            
            if ($Browser -ne "all") {
                $testArgs += "--project=$Browser"
            }
            
            # Playwright 테스트 실행
            $testOutput = & "node_modules\.bin\playwright.cmd" @testArgs 2>&1
            
            if ($LASTEXITCODE -eq 0) {
                Write-Success "    ✅ 통과"
                $global:TestResults.PassedTests++
                $phaseResults.Tests += @{ Name = $spec; Result = "PASS"; Error = $null }
            } else {
                Write-Error "    ❌ 실패"
                $global:TestResults.FailedTests++
                $phaseResults.Tests += @{ Name = $spec; Result = "FAIL"; Error = $testOutput }
                $phaseResults.Success = $false
            }
            
        } catch {
            Handle-Error "테스트 실행 중 오류: $spec" $_
            $global:TestResults.FailedTests++
            $phaseResults.Tests += @{ Name = $spec; Result = "ERROR"; Error = $_.Message }
            $phaseResults.Success = $false
        }
        
        $global:TestResults.TotalTests++
    }
    
    $phaseResults.EndTime = Get-Date
    $phaseResults.Duration = ($phaseResults.EndTime - $phaseResults.StartTime).TotalSeconds
    
    $global:TestResults.Phases[$PhaseName] = $phaseResults
    
    # Phase 결과 출력
    if ($phaseResults.Success) {
        Write-Success "✅ $PhaseName 완료 (${phaseResults.Duration}초)"
    } else {
        Write-Error "❌ $PhaseName 실패 (${phaseResults.Duration}초)"
    }
    
    return $phaseResults.Success
}

# 성능 테스트 실행 함수
function Run-PerformanceTests {
    Write-Info "⚡ 성능 테스트 실행 중..."
    
    try {
        $perfScript = "tests\performance\expansion-monitor.js"
        if (!(Test-Path $perfScript)) {
            Write-Warning "⚠️ 성능 테스트 스크립트가 없습니다: $perfScript"
            return $true
        }
        
        Write-Host "  🔍 성능 모니터링 시작..." -ForegroundColor White
        
        # Node.js로 성능 모니터 실행
        $perfOutput = node $perfScript 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✅ 성능 테스트 통과"
            return $true
        } else {
            Write-Error "  ❌ 성능 테스트 실패"
            Write-Host $perfOutput -ForegroundColor Red
            return $false
        }
        
    } catch {
        Handle-Error "성능 테스트 실행 중 오류" $_
        return $false
    }
}

# 모바일 테스트 실행 함수
function Run-MobileTests {
    Write-Info "📱 모바일 테스트 실행 중..."
    
    try {
        $mobileArgs = @(
            "test",
            "tests\playwright\poi-expansion.spec.js",
            "--grep", "모바일",
            "--reporter=json"
        )
        
        if ($Headless) {
            $mobileArgs += "--headed=$false"
        }
        
        $testOutput = & "node_modules\.bin\playwright.cmd" @mobileArgs 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "✅ 모바일 테스트 통과"
            return $true
        } else {
            Write-Error "❌ 모바일 테스트 실패"
            Write-Host $testOutput -ForegroundColor Red
            return $false
        }
        
    } catch {
        Handle-Error "모바일 테스트 실행 중 오류" $_
        return $false
    }
}

# 브라우저별 테스트 함수  
function Run-BrowserTests {
    param($BrowserName)
    
    Write-Info "🌐 $BrowserName 브라우저 테스트 실행 중..."
    
    try {
        $browserArgs = @(
            "test",
            "tests\playwright\poi-expansion.spec.js",
            "--grep", "브라우저 호환성",
            "--project=$BrowserName",
            "--reporter=json"
        )
        
        if ($Headless) {
            $browserArgs += "--headed=$false"
        }
        
        $testOutput = & "node_modules\.bin\playwright.cmd" @browserArgs 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Success "  ✅ $BrowserName 호환성 확인"
            return $true
        } else {
            Write-Error "  ❌ $BrowserName 호환성 실패"
            return $false
        }
        
    } catch {
        Handle-Error "$BrowserName 테스트 실행 중 오류" $_
        return $false
    }
}

# 리포트 생성 함수
function Generate-Report {
    Write-Info "📊 테스트 리포트 생성 중..."
    
    try {
        $reportData = @{
            Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
            Configuration = @{
                Phase = $Phase
                Browser = $Browser
                Performance = $Performance
                Mobile = $Mobile
                ServerPort = $ServerPort
            }
            Summary = @{
                TotalTests = $global:TestResults.TotalTests
                PassedTests = $global:TestResults.PassedTests
                FailedTests = $global:TestResults.FailedTests
                SuccessRate = if ($global:TestResults.TotalTests -gt 0) { 
                    [math]::Round(($global:TestResults.PassedTests / $global:TestResults.TotalTests) * 100, 2) 
                } else { 0 }
                Duration = ((Get-Date) - $global:TestResults.StartTime).TotalMinutes
            }
            Phases = $global:TestResults.Phases
            Errors = $global:TestResults.Errors
        }
        
        # JSON 리포트
        $jsonReport = $reportData | ConvertTo-Json -Depth 10
        $jsonPath = "tests\reports\qa-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
        $jsonReport | Out-File -FilePath $jsonPath -Encoding UTF8
        
        # HTML 리포트 생성
        $htmlPath = Generate-HTMLReport $reportData
        
        Write-Success "✅ 리포트 생성 완료:"
        Write-Host "  📄 JSON: $jsonPath" -ForegroundColor White
        Write-Host "  🌐 HTML: $htmlPath" -ForegroundColor White
        
        # 요약 출력
        Write-Host ""
        Write-Host "📊 테스트 결과 요약:" -ForegroundColor Cyan
        Write-Host "  • 총 테스트: $($reportData.Summary.TotalTests)" -ForegroundColor White
        Write-Host "  • 통과: $($reportData.Summary.PassedTests)" -ForegroundColor Green
        Write-Host "  • 실패: $($reportData.Summary.FailedTests)" -ForegroundColor Red
        Write-Host "  • 성공률: $($reportData.Summary.SuccessRate)%" -ForegroundColor $(if ($reportData.Summary.SuccessRate -ge 90) { "Green" } elseif ($reportData.Summary.SuccessRate -ge 70) { "Yellow" } else { "Red" })
        Write-Host "  • 소요시간: $([math]::Round($reportData.Summary.Duration, 1))분" -ForegroundColor White
        
        return $reportData.Summary.SuccessRate -ge 80 # 80% 이상 성공시 true
        
    } catch {
        Handle-Error "리포트 생성 중 오류" $_
        return $false
    }
}

# HTML 리포트 생성 함수
function Generate-HTMLReport {
    param($ReportData)
    
    $htmlPath = "tests\reports\qa-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').html"
    
    $html = @"
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>미야코지마 QA 테스트 리포트</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: #f8f9fa; padding: 15px; border-radius: 6px; border-left: 4px solid #007bff; }
        .card.success { border-left-color: #28a745; background: #f8fff8; }
        .card.warning { border-left-color: #ffc107; background: #fffbf0; }
        .card.error { border-left-color: #dc3545; background: #fff5f5; }
        .metric { font-size: 24px; font-weight: bold; margin: 5px 0; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; }
        .pass { color: #28a745; font-weight: bold; }
        .fail { color: #dc3545; font-weight: bold; }
        .error { color: #dc3545; font-weight: bold; }
        .phase-success { background: #d4edda; }
        .phase-error { background: #f8d7da; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🏝️ 미야코지마 웹 플랫폼 QA 테스트 리포트</h1>
        <p><strong>생성 시간:</strong> $($ReportData.Timestamp)</p>
        
        <div class="summary">
            <div class="card $(if ($ReportData.Summary.SuccessRate -ge 90) { 'success' } elseif ($ReportData.Summary.SuccessRate -ge 70) { 'warning' } else { 'error' })">
                <h3>전체 성공률</h3>
                <div class="metric">$($ReportData.Summary.SuccessRate)%</div>
            </div>
            <div class="card">
                <h3>총 테스트</h3>
                <div class="metric">$($ReportData.Summary.TotalTests)</div>
            </div>
            <div class="card success">
                <h3>통과</h3>
                <div class="metric">$($ReportData.Summary.PassedTests)</div>
            </div>
            <div class="card error">
                <h3>실패</h3>
                <div class="metric">$($ReportData.Summary.FailedTests)</div>
            </div>
        </div>
        
        <h2>Phase별 결과</h2>
        <table>
            <thead>
                <tr><th>Phase</th><th>상태</th><th>소요시간</th><th>테스트 수</th></tr>
            </thead>
            <tbody>
"@
    
    foreach ($phase in $ReportData.Phases.GetEnumerator()) {
        $phaseClass = if ($phase.Value.Success) { "phase-success" } else { "phase-error" }
        $statusIcon = if ($phase.Value.Success) { "✅" } else { "❌" }
        
        $html += @"
                <tr class="$phaseClass">
                    <td>$($phase.Value.Name)</td>
                    <td>$statusIcon $(if ($phase.Value.Success) { '통과' } else { '실패' })</td>
                    <td>${[math]::Round($phase.Value.Duration, 1)}초</td>
                    <td>$($phase.Value.Tests.Count)</td>
                </tr>
"@
    }
    
    $html += @"
            </tbody>
        </table>
        
        <h2>상세 테스트 결과</h2>
        <table>
            <thead>
                <tr><th>Phase</th><th>테스트</th><th>결과</th><th>오류</th></tr>
            </thead>
            <tbody>
"@
    
    foreach ($phase in $ReportData.Phases.GetEnumerator()) {
        foreach ($test in $phase.Value.Tests) {
            $resultClass = switch ($test.Result) {
                "PASS" { "pass" }
                "FAIL" { "fail" } 
                "ERROR" { "error" }
            }
            
            $html += @"
                <tr>
                    <td>$($phase.Value.Name)</td>
                    <td>$($test.Name)</td>
                    <td class="$resultClass">$($test.Result)</td>
                    <td>$(if ($test.Error) { [System.Web.HttpUtility]::HtmlEncode($test.Error.ToString().Substring(0, [Math]::Min(100, $test.Error.ToString().Length))) } else { '-' })</td>
                </tr>
"@
        }
    }
    
    $html += @"
            </tbody>
        </table>
        
        <details>
            <summary>원시 데이터</summary>
            <pre>$($ReportData | ConvertTo-Json -Depth 10)</pre>
        </details>
    </div>
</body>
</html>
"@
    
    $html | Out-File -FilePath $htmlPath -Encoding UTF8
    return $htmlPath
}

# 정리 함수
function Cleanup {
    param($ServerJob)
    
    Write-Info "🧹 정리 작업 중..."
    
    if ($ServerJob) {
        try {
            Stop-Job -Job $ServerJob -Force
            Remove-Job -Job $ServerJob -Force
            Write-Success "✅ 로컬 서버 종료됨"
        } catch {
            Write-Warning "⚠️ 서버 종료 중 오류: $($_.Message)"
        }
    }
}

# =============================================================================
# 메인 실행 로직
# =============================================================================

try {
    # 1. 사전 요구사항 검증
    if (!(Test-Prerequisites)) {
        throw "사전 요구사항 검증 실패"
    }
    
    # 2. 로컬 서버 시작
    $serverJob = Start-LocalServer
    if (!$serverJob) {
        throw "로컬 서버 시작 실패"
    }
    
    # 3. Playwright 설치 확인
    Write-Info "🎭 Playwright 브라우저 설치 확인 중..."
    & "node_modules\.bin\playwright.cmd" install --with-deps
    
    Start-Sleep -Seconds 2
    
    # 4. Phase별 테스트 실행
    $overallSuccess = $true
    
    # 기본 기능 테스트 (모든 Phase 공통)
    $coreTests = @(
        "tests\playwright\poi-expansion.spec.js"
    )
    
    if ($Phase -eq "all" -or $Phase -eq "phase1") {
        $success = Run-PhaseTests "기존 13개 POI 무결성 검증" @("tests\playwright\poi-expansion.spec.js --grep '기존 13개 POI'")
        $overallSuccess = $overallSuccess -and $success
    }
    
    if ($Phase -eq "all" -or $Phase -eq "phase2") {
        $success = Run-PhaseTests "검색 및 필터링 기능" @("tests\playwright\poi-expansion.spec.js --grep '검색 및 필터링'")
        $overallSuccess = $overallSuccess -and $success
    }
    
    if ($Phase -eq "all" -or $Phase -eq "phase3") {
        $success = Run-PhaseTests "성능 벤치마크" @("tests\playwright\poi-expansion.spec.js --grep '성능 벤치마크'")
        $overallSuccess = $overallSuccess -and $success
    }
    
    if ($Phase -eq "all" -or $Phase -eq "phase4") {
        $success = Run-PhaseTests "PWA 및 오프라인" @("tests\playwright\poi-expansion.spec.js --grep '오프라인'")
        $overallSuccess = $overallSuccess -and $success
    }
    
    # 5. 브라우저별 테스트
    if ($Browser -eq "all") {
        foreach ($browserName in @("chromium", "firefox", "webkit")) {
            $success = Run-BrowserTests $browserName
            $overallSuccess = $overallSuccess -and $success
        }
    } elseif ($Browser -ne "chromium") {
        $success = Run-BrowserTests $Browser
        $overallSuccess = $overallSuccess -and $success
    }
    
    # 6. 성능 테스트 (옵션)
    if ($Performance) {
        $success = Run-PerformanceTests
        $overallSuccess = $overallSuccess -and $success
    }
    
    # 7. 모바일 테스트 (옵션)
    if ($Mobile) {
        $success = Run-MobileTests
        $overallSuccess = $overallSuccess -and $success
    }
    
    # 8. 리포트 생성
    if ($Report) {
        $reportSuccess = Generate-Report
        $overallSuccess = $overallSuccess -and $reportSuccess
    }
    
    # 9. 최종 결과 출력
    Write-Host ""
    Write-Host "=" * 80 -ForegroundColor Magenta
    if ($overallSuccess) {
        Write-Success "🎉 모든 테스트가 성공적으로 완료되었습니다!"
        $exitCode = 0
    } else {
        Write-Error "💥 일부 테스트가 실패했습니다. 리포트를 확인하세요."
        $exitCode = 1
    }
    Write-Host "=" * 80 -ForegroundColor Magenta
    
} catch {
    Handle-Error "스크립트 실행 중 치명적 오류" $_
    $exitCode = 1
    
} finally {
    # 정리 작업
    Cleanup $serverJob
    
    Write-Host ""
    Write-Info "📝 실행 로그:"
    Write-Host "   시작: $($global:TestResults.StartTime.ToString('yyyy-MM-dd HH:mm:ss'))"
    Write-Host "   종료: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Host "   소요: $([math]::Round(((Get-Date) - $global:TestResults.StartTime).TotalMinutes, 1))분"
}

# 종료 코드 반환 (CI/CD 연동용)
exit $exitCode