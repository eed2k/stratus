# Weather Station Platform Design Guidelines

## Design Approach
**Design System:** Material Design with data visualization specialization
**Rationale:** Data-dense professional monitoring tool requiring clarity, structure, and established patterns for charts, cards, and dashboards. Material Design's elevation system and grid structure excel at organizing complex information hierarchies.

## Core Design Principles
1. **Data First:** Prioritize readability and scanability of weather metrics
2. **Hierarchy Through Structure:** Use cards, elevation, and spacing to create clear information zones
3. **Responsive Density:** Adaptive layouts that maintain data accessibility on all screen sizes
4. **Professional Precision:** Clean, technical aesthetic appropriate for weather monitoring

## Typography System
**Font Family:** Inter (primary), Roboto Mono (data/metrics)

**Hierarchy:**
- Dashboard Title: text-3xl font-semibold
- Section Headers: text-xl font-semibold
- Card Titles: text-lg font-medium
- Body Text: text-base font-normal
- Data Labels: text-sm font-medium
- Metric Values: text-2xl to text-4xl font-bold (Roboto Mono)
- Timestamps: text-xs font-normal text-gray-500

## Layout System
**Spacing Primitives:** Tailwind units of 2, 4, 6, and 8 (p-4, gap-6, m-8, etc.)

**Grid Structure:**
- Desktop: 12-column grid with gap-6
- Tablet: 8-column grid with gap-4
- Mobile: Single column with gap-4

**Container Widths:**
- Dashboard: max-w-screen-2xl (full data view)
- Forms/Auth: max-w-md
- Content sections: max-w-7xl

**Consistent Padding:**
- Cards: p-6
- Sections: py-8 to py-12
- Page margins: px-4 md:px-6 lg:px-8

## Component Library

### Navigation
**Top Navigation Bar:**
- Fixed header with elevation shadow
- Logo left, station selector center, user menu right
- Height: h-16
- Includes: notification bell, settings icon, dark mode toggle

**Sidebar (Desktop):**
- Width: w-64
- Collapsible to w-16 (icon-only)
- Sections: Dashboard, Stations, History, Reports, Settings

### Dashboard Cards
**Weather Metric Cards:**
- Rounded corners: rounded-lg
- Elevation: shadow-md with hover:shadow-lg transition
- Structure: Icon + Label + Large Value + Sub-metrics + Mini-chart
- Grid: 2-3 columns desktop, 1 column mobile

**Current Conditions Card:**
- Prominent placement (full width or 2/3 width)
- Large temperature display with weather icon
- Grid of 6-8 secondary metrics below

### Data Visualization

**Charts:**
- Full-width time-series charts using Chart.js or Recharts
- Height: h-64 to h-96 depending on importance
- Toolbar above: time range selector (10min, 1hr, 24hr, 7d, 30d)
- Legend positioned top-right
- Grid lines subtle, axis labels clear

**Wind Rose:**
- Square aspect ratio (aspect-square)
- Centered in dedicated card
- 16-sector circular chart
- Legend showing speed classes with clear color coding
- Minimum size: 320px × 320px

**Mini Charts (Sparklines):**
- Embedded in metric cards
- Height: h-12 to h-16
- No axes, minimal styling, trend visualization only

### Forms & Inputs
**Authentication Pages:**
- Centered card layout (max-w-md)
- Generous padding (p-8)
- Clear form labels above inputs
- Input fields: h-12 with rounded-md borders
- Primary action buttons full-width

**Data Controls:**
- Date pickers with calendar dropdown
- Time range buttons as pill-style toggle group
- Station selector as searchable dropdown
- Refresh interval selector with auto-update indicator

### Tables
**Historical Data Table:**
- Striped rows for readability
- Sticky header on scroll
- Sortable columns with arrow indicators
- Export button in top-right
- Pagination at bottom
- Row height: h-12
- Alternating row backgrounds for density

### Overlays
**Modals:**
- Max width: max-w-2xl for forms, max-w-4xl for data views
- Backdrop: Semi-transparent overlay
- Padding: p-6
- Close button top-right

**Alerts/Notifications:**
- Toast notifications top-right
- Fixed positioning with stacking
- Auto-dismiss after 5s
- Status indicators (success, warning, error, info)

## Page Layouts

### Dashboard (Primary View)
1. Top bar with station selector and auto-refresh status
2. Current conditions hero card (full width)
3. Grid of 6-8 key metric cards (2-3 columns)
4. Full-width charts section with tabs (Temperature, Wind, Pressure, etc.)
5. Wind rose + statistics cards (side by side on desktop)
6. Recent activity feed (if applicable)

### Station Management
- List view with station cards
- Each card: Station name, location, status indicator, last update time
- Grid: 1-3 columns responsive
- Add station button prominent top-right

### Historical Data
- Date range selector at top
- Filters panel (collapsible sidebar)
- Main area: Chart view / Table view toggle
- Export controls

### Authentication
- Centered card on minimal background
- Logo at top
- Social login buttons with icons
- Divider with "or"
- Email/password form below

## Responsive Breakpoints
- Mobile: < 768px (single column, collapsible nav)
- Tablet: 768px - 1024px (2 columns, persistent nav)
- Desktop: > 1024px (3 columns, full features)

## Accessibility
- All interactive elements: min h-11 (44px touch target)
- Form inputs with visible focus rings
- Icon buttons include aria-labels
- Charts include data tables for screen readers
- Skip navigation link for keyboard users

## Animation Strategy
**Minimal & Purposeful:**
- Card hover elevations: transition-shadow duration-200
- Data updates: subtle fade-in for new values
- Page transitions: none (instant for data apps)
- Charts: animate initial render only
- Loading states: simple spinner, no skeleton screens

## Icons
**Library:** Heroicons (outline for navigation, solid for status)
- Weather icons: Custom weather icon set or Heroicons supplemented
- Metric cards: Relevant icons (thermometer, wind, droplet, etc.)
- Size: w-5 h-5 for inline, w-6 h-6 for card headers

## Images
**No hero images** - this is a data-focused application where screen real estate is precious.

**Station Photos (Optional):**
- Small thumbnail in station selector
- Larger image in station details modal
- Aspect ratio: 16:9, rounded corners