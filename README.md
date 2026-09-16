# DTR — Daily Time Record System

A modern, high-performance Daily Time Record (DTR) and internship attendance tracking system built with Node.js, Express, and modern JavaScript. Features automatic overtime calculation, overnight shift handling, Philippine holiday detection, multiple OJT requirement tracking, and flexible export formats.

🌐 **Live Demo:** [https://dtrnilatch.vercel.app](https://dtrnilatch.vercel.app)

---

## ⚡ Highlights & Features

### 🕒 Time Tracking & Calculation Engine
- **Accurate Duration & Overtime**: Calculates credited hours, overtime, tardiness (late arrival), and undertime based on customizable daily thresholds.
- **Overnight Shift Support**: Seamlessly calculates shifts spanning past midnight without date distortion.
- **Absent Record Logging**: Track excused/unexcused absences with zero-hour recording and clear visual badges.
- **Lunch Deduction**: Configurable lunch window overlap deductions (e.g., 12:00 PM – 1:00 PM).
- **Holiday Engine**: Built-in Philippine regular and special non-working holidays with support for custom date additions and overrides.

### 🎓 Internship & OJT Management
- **Multiple OJT Goals**: Create and switch between multiple internship programs (e.g., OJT 1, Practicum B).
- **Real-Time Progress**: Dynamic progress bar, target completion dates, and risk indicators (On Track / Overtime Needed / Behind Schedule).
- **Comprehensive Profiles**: Student ID, university/school, course, company, department, and supervisor tracking.

### 📤 Export & Batch Import
- **Printable Reports**: Formatted University / OJT Timesheets ready for supervisor signatures.
- **CSV Data Export**: One-click raw CSV export for spreadsheets and institutional archiving.
- **Batch Text & CSV Import**: Flexible parser supporting multiple date/time string formats with smart duplicate strategies (*Skip*, *Replace*, or *Keep Both*).

### 👥 Administration & Multi-Role Access
- **Admin Dashboard**: Real-time overview of all registered trainees, individual time records, and overall completion percentages.
- **Staff Controls**: Adjust student hour goals, inspect audit trails, and execute administrative password resets.

### 🎨 Modern Architecture & User Experience
- **Sleek UI & Themes**: Dual theme support (Dark / Light) with multiple curated accent palettes (Sky, Emerald, Violet, Amber, Rose, etc.).
- **Optimistic State & Instant Boot**: Instant dashboard display on refresh with resilient background authentication verification.
- **Accessibility & SEO**: Semantic landmarks (`<main>`), full `aria-label` coverage on time wheels, preconnected fonts, and valid `robots.txt`.
- **Hybrid Storage**: Full MongoDB persistence with automatic in-memory fallback if database connection is unavailable.

---

## 🛠️ Tech Stack

- **Frontend**: HTML5, Vanilla CSS (Design Tokens, responsive layouts), Vanilla JavaScript (ES Modules)
- **Backend**: Node.js, Express 4, Mongoose 8 (MongoDB)
- **Authentication**: Stateless JSON Web Tokens (JWT) + bcrypt password hashing
- **Deployment**: Vercel Serverless Fullstack (`api/` serverless functions + edge CDN static hosting)

---

## 📁 Project Structure

```text
├── api/                       # Vercel serverless function entry points
│   ├── index.js               # Main serverless Express app export
│   └── [...all].js            # Serverless catch-all router
├── backend/                   # Backend API source code
│   └── src/
│       ├── app.js             # Express application configuration & routing
│       ├── server.js          # Standalone Node.js server entry point
│       ├── config/            # Database & environment configurations
│       ├── middleware/        # JWT authentication & role-based middleware
│       ├── models/            # Mongoose schemas & in-memory fallback stores
│       ├── routes/            # REST API route handlers (auth, dtr, ojt, etc.)
│       └── utils/             # Calculation engine, holiday engine, audit logger
├── css/                       # Modular stylesheet architecture
│   ├── base.css               # Design tokens, typography, CSS variables
│   ├── components.css         # UI components (buttons, badges, inputs, modals)
│   └── layout.css             # Grid layouts, responsive dashboards, navbars
├── js/                        # Client-side ES modules
│   ├── app.js                 # App initialization, routing & session restore
│   ├── api.js                 # Unified fetch API client
│   ├── auth.js                # Client authentication helpers
│   ├── storage.js             # LocalStorage caching layer
│   ├── ui.js                  # DOM helpers, modal management, toasts, themes
│   ├── calcEngine.js          # Client-side time calculation engine
│   ├── export.js              # CSV and printable template generation
│   ├── userDashboard.js       # Trainee workspace & session management
│   └── adminDashboard.js      # Admin management panel
├── tests/                     # Unit test suites
│   └── calcEngine.test.js     # Calculation engine tests
├── index.html                 # Main Single-Page Application (SPA)
├── vercel.json                # Vercel deployment and routing configuration
└── robots.txt                 # Search engine crawler directives
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [MongoDB](https://www.mongodb.com/) (Optional: an in-memory data store is automatically used if MongoDB URI is omitted)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/DoubleCarry/DTRv2.git
   cd DTRprojV2
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   Copy `.env.example` to `.env` and configure your settings:
   ```bash
   cp .env.example .env
   ```

   Example `.env` configuration:
   ```env
   PORT=3000
   MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/dtr?retryWrites=true&w=majority
   JWT_SECRET=your-super-secret-jwt-key
   ADMIN_USERNAME=admin
   ADMIN_PASSWORD=admin12345
   ADMIN_NAME=Administrator
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:3000`.

---

## 🧪 Testing & Linting

Run the test suite:
```bash
npm test
```

Run syntax and static analysis validation:
```bash
npm run lint
```

---

## 🌐 Deployment (Vercel)

This repository is optimized for one-click deployment on [Vercel](https://vercel.com).

1. Push your repository to GitHub.
2. Import the project into your Vercel Dashboard.
3. Configure the following Environment Variables in your Vercel project settings:
   - `MONGODB_URI`: Your MongoDB connection string.
   - `JWT_SECRET`: A secure random secret string.
   - `ADMIN_USERNAME`: Default admin username (default: `admin`).
   - `ADMIN_PASSWORD`: Default admin password.
4. Deploy! Vercel will automatically build the static assets and mount the serverless API.

---

## 📄 License

This project is licensed under the MIT License — see the LICENSE file for details.
