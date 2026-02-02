# JobFill Auto-Debugger v2.0 🤖

Automated job application form filler using **hybrid ML classification** for maximum accuracy. Uses a two-stage approach: Zero-Shot NLI Classification + Semantic Similarity Fallback.

## 🆕 What's New in v2.0

### Hybrid Classification Architecture
```
Field: "Are you legally eligible to work in the US?"
                    │
                    ▼
        ┌─────────────────────────────┐
        │  STAGE 1: Zero-Shot NLI     │
        │  DeBERTa-v3-large (435M)    │
        │  Confidence: 42%            │  ← Below 45% threshold
        └─────────────────────────────┘
                    │
                    ▼
        ┌─────────────────────────────┐
        │  STAGE 2: Semantic Similarity│
        │  BGE-M3 (568M params)       │
        │  Match: 85%                 │  ← Above 60% threshold  
        └─────────────────────────────┘
                    │
                    ▼
        Result: "work_authorization" → Fill with "Yes"
```

### Models Used
| Model | Purpose | Params | Accuracy |
|-------|---------|--------|----------|
| `MoritzLaurer/deberta-v3-large-zeroshot-v2.0` | Zero-shot classification | 435M | SOTA |
| `Xenova/bge-m3` | Semantic similarity | 568M | MTEB ~65 |

### Key Improvements
- **~95%+ accuracy** (up from ~85%)
- **Two-stage fallback** - if zero-shot is unsure, semantic similarity kicks in
- **Larger models** - prioritizes accuracy over speed
- **Enhanced Workday support** - more selectors, dynamic patterns, aria-label matching

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Download Models (IMPORTANT - ~3-4 GB)
```bash
npm run download-model
```
This downloads both models and caches them locally. First run takes 5-15 minutes.

### 3. Configure Profile
```bash
npm run setup
```

### 4. Run
```bash
npm run assisted <URL>  # Interactive mode
npm start <URL>         # Automated mode
```

### 5. Test Classifier (Optional)
```bash
npm run test-classifier
```

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                  NEGATIVE FEEDBACK LOOP                      │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐              │
│   │  Fill    │───▶│ Capture  │───▶│  Send to │              │
│   │  Form    │    │  Logs +  │    │  Claude  │              │
│   │          │    │ Screenshot│    │   API    │              │
│   └──────────┘    └──────────┘    └────┬─────┘              │
│        ▲                               │                     │
│        │         ┌─────────────────────┘                     │
│        │         ▼                                           │
│   ┌────┴─────┐   ┌──────────┐                               │
│   │  Reload  │◀──│ Generate │                               │
│   │   and    │   │ & Apply  │                               │
│   │  Retry   │   │  Fixes   │                               │
│   └──────────┘   └──────────┘                               │
│                                                              │
│   STOP when: All required fields filled successfully         │
└─────────────────────────────────────────────────────────────┘
```

## Three Testing Modes

| Mode | Command | Use Case |
|------|---------|----------|
| **Assisted** | `npm run assisted <url>` | Interactive - you login, script fills forms |
| **Session** | `npm start --url <url>` | Uses saved cookies, fully automated |
| **Batch** | `npm start --batch` | Tests multiple URLs from test-urls.json |

## Quick Start

### 1. Install Dependencies

```bash
cd jobfill-auto-debugger
npm install
```

### 2. Configure API Key

Copy the example environment file and add your API key:

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
EXTENSION_PATH=/path/to/jobfill-pro-v5/chrome-extension
```

### 3. Set Up Your Profile (REQUIRED)

Run the interactive profile wizard to enter your information:

```bash
npm run setup
```

This will ask you for:
- **Personal Info**: Name, email, phone
- **Address**: Street, city, state, ZIP, country
- **Work Authorization**: US work eligibility, sponsorship needs
- **Export Control**: ITAR/EAR eligibility (US Person status)
- **Demographics**: Gender, race, veteran status, disability (voluntary)
- **Employment**: Years of experience, current job
- **Education**: Degree, university, major
- **Documents**: Path to your resume PDF

Your profile is saved to `profile.json` (gitignored for privacy).

### 4. Run in Assisted Mode (Recommended for First Time)

```bash
npm run assisted "https://company.wd5.myworkdayjobs.com/careers/job/12345"
```

This will:
1. Open browser with JobFill extension loaded
2. Navigate to the job URL
3. **Pause for you to login manually** (if needed)
4. Save your session cookies for next time
5. Navigate through all pages, filling forms
6. Analyze failures, suggest and apply fixes
7. Repeat until success

### 4. Run in Fully Automated Mode (After Sessions Saved)

```bash
npm start -- --url "https://company.wd5.myworkdayjobs.com/careers/job/12345"
```

### 5. Run Batch Tests

```bash
npm start -- --batch --headless
```

## Handling Multi-Page Applications

The debugger automatically:

1. **Detects page type** (Personal Info, Experience, Education, etc.)
2. **Fills all fields** on current page
3. **Clicks "Next"/"Continue"** button
4. **Repeats** until reaching submission page
5. **Stops before submitting** (safety feature)

```
Page 1: Personal Information → Fill → Next →
Page 2: Work Experience → Fill → Next →
Page 3: Education → Fill → Next →
Page 4: Voluntary EEO → Fill → Next →
Page 5: Review & Submit → STOP (manual submit)
```

## Handling Login

### First Time (Assisted Mode)
```
🔐 LOGIN REQUIRED
   Please log in manually in the browser window.
   Press ENTER when ready to continue...

[You login manually]

Save this session for future use? (y/n): y
💾 Session saved for workday_company (45 cookies)
```

### Subsequent Runs
```
Found saved session. Use it? (y/n): y
🍪 Loaded 45 cookies for workday_company
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--url <url>` | Test a single job application URL |
| `--batch` | Run batch test from test-urls.json |
| `--iterations <n>` | Max debug iterations per URL (default: 5) |
| `--headless` | Run browser in headless mode |
| `--revert` | Revert all applied patches |

## How Sessions Work

Sessions are saved per-platform-per-company:
- `workday_google` - Google's Workday instance
- `successfactors_ametek` - Ametek's SuccessFactors
- `greenhouse_stripe` - Stripe's Greenhouse

Sessions include:
- All cookies
- localStorage data
- sessionStorage data
- 7-day expiration

Sessions are stored in `sessions/` directory.

## How Fixes Are Generated

Claude analyzes:
1. **Console logs** - All `[JobFill DEBUG]` messages
2. **DOM state** - Which fields exist and their fill status
3. **Fill results** - Success/failure counts
4. **Error messages** - Any JavaScript errors

Claude then generates targeted fixes in this format:
```xml
<fix>
<file>lib/platform-handlers.js</file>
<description>Fix dropdown popup detection</description>
<search>
// exact code to find
</search>
<replace>
// new code
</replace>
</fix>
```

## Safety Features

- **Automatic backups** before any file modification
- **Revert command** to undo all changes: `npm start -- --revert`
- **Syntax validation** before applying patches
- **Unique string matching** prevents accidental changes

## Scaling Up

To test hundreds of URLs:

1. Add URLs to `test-urls.json`
2. Run: `npm start -- --batch --headless`
3. Review reports in `reports/`

For maximum efficiency:
- Use `--headless` mode
- Increase iterations for complex sites
- Run overnight for large batches

## Tips

- Start with one URL to verify setup
- Add URLs from different ATS platforms
- Review generated patches before committing
- Run `--revert` if something breaks

## Troubleshooting

**"ANTHROPIC_API_KEY not set"**
- Create `.env` file with your API key

**"Extension not loaded"**
- Check `EXTENSION_PATH` in `.env`
- Ensure manifest.json exists in extension directory

**"No fixes generated"**
- Claude may need more context
- Try increasing iterations
- Check logs for unusual patterns
