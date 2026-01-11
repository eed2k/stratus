/**
 * Feature Flags Configuration
 * Controls which features are available based on deployment environment
 * 
 * Netlify deployment: Read-only mode (no editing, admin, or setup)
 * Desktop EXE/Railway: Full admin capabilities
 */

// Check if running in read-only mode (Netlify deployment)
export const isReadOnlyMode = import.meta.env.VITE_READ_ONLY === 'true';
export const isNetlifyDeployment = import.meta.env.VITE_DEPLOYMENT === 'netlify';

// Feature availability flags
export const features = {
  // Data viewing features (always available)
  canViewDashboard: true,
  canViewData: true,
  canViewCharts: true,
  canExportData: true,
  
  // Admin/modification features (disabled in read-only mode)
  canEditStations: !isReadOnlyMode,
  canAddStations: !isReadOnlyMode,
  canDeleteStations: !isReadOnlyMode,
  canConfigureSettings: !isReadOnlyMode,
  canManageUsers: !isReadOnlyMode,
  canDeleteData: !isReadOnlyMode,
  canSetupStations: !isReadOnlyMode,
  canManageAlarms: !isReadOnlyMode,
  
  // UI elements visibility
  showAdminMenu: !isReadOnlyMode,
  showSetupWizard: !isReadOnlyMode,
  showSettingsPage: !isReadOnlyMode,
  showEditButtons: !isReadOnlyMode,
  showDeleteButtons: !isReadOnlyMode,
};

// Log feature flags in development
if (import.meta.env.DEV) {
  console.log('[Features] Read-only mode:', isReadOnlyMode);
  console.log('[Features] Netlify deployment:', isNetlifyDeployment);
  console.log('[Features] Available features:', features);
}
