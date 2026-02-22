using System.IO;
using System.Windows;
using Serilog;

namespace Stratus.Desktop.Views;

public partial class SetupWizardDialog : Window
{
    public bool SetupCompleted { get; private set; }
    public string ServerUrl => ServerUrlBox.Text.Trim();
    public string LicenseKey => LicenseKeyBox.Text.Trim();
    public string HolderName => HolderNameBox.Text.Trim();
    public string Organization => OrganizationBox.Text.Trim();
    public bool CreateDesktopShortcut => CreateShortcutCheckBox.IsChecked == true;
    public bool CreateStartMenuShortcut => CreateStartMenuCheckBox.IsChecked == true;

    public SetupWizardDialog()
    {
        InitializeComponent();
    }

    private void AcceptEula_Changed(object sender, RoutedEventArgs e)
    {
        FinishButton.IsEnabled = AcceptEulaCheckBox.IsChecked == true;
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        var result = MessageBox.Show(
            "Are you sure you want to cancel setup?\nThe application will close.",
            "Cancel Setup", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (result == MessageBoxResult.Yes)
        {
            SetupCompleted = false;
            DialogResult = false;
            Close();
        }
    }

    private void Finish_Click(object sender, RoutedEventArgs e)
    {
        // Validate URL
        if (string.IsNullOrWhiteSpace(ServerUrl) || 
            (!ServerUrl.StartsWith("http://") && !ServerUrl.StartsWith("https://")))
        {
            StatusText.Text = "Please enter a valid server URL (starting with http:// or https://).";
            StatusText.Visibility = Visibility.Visible;
            return;
        }

        // Activate license if key provided
        if (!string.IsNullOrWhiteSpace(LicenseKey))
        {
            var result = App.LicenseService.ActivateLicense(LicenseKey, HolderName, Organization);
            if (!result.Success)
            {
                StatusText.Text = $"Licence activation failed: {result.Message}\nYou can leave the key blank to start a trial.";
                StatusText.Visibility = Visibility.Visible;
                return;
            }
            Log.Information("Setup: License activated - {Type}", result.License?.Type);
        }
        else
        {
            // Auto-generate trial
            App.LicenseService.GenerateTrialLicense();
            Log.Information("Setup: Trial license generated");
        }

        // Create shortcuts
        try
        {
            var exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
            if (!string.IsNullOrEmpty(exePath))
            {
                if (CreateDesktopShortcut)
                    CreateShortcut(
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Stratus.lnk"),
                        exePath);

                if (CreateStartMenuShortcut)
                {
                    var startMenuDir = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                        "Programs", "Stratus");
                    Directory.CreateDirectory(startMenuDir);
                    CreateShortcut(Path.Combine(startMenuDir, "Stratus.lnk"), exePath);
                }
            }
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to create shortcuts");
            // Non-fatal, continue
        }

        // Mark setup complete
        var setupMarker = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "Stratus", ".setup-complete");
        File.WriteAllText(setupMarker, DateTime.UtcNow.ToString("O"));

        SetupCompleted = true;
        DialogResult = true;
        Close();
    }

    /// <summary>
    /// Creates a Windows shortcut (.lnk) using COM WScript.Shell.
    /// </summary>
    private static void CreateShortcut(string shortcutPath, string targetPath)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(shortcutPath);
            shortcut.TargetPath = targetPath;
            shortcut.WorkingDirectory = Path.GetDirectoryName(targetPath);
            shortcut.Description = "Stratus Weather Station Manager";
            shortcut.Save();
            Log.Information("Created shortcut: {Path}", shortcutPath);
        }
        catch (Exception ex)
        {
            Log.Warning(ex, "Failed to create shortcut at {Path}", shortcutPath);
        }
    }
}
