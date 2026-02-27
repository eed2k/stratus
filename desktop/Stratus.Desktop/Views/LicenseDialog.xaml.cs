using System.Windows;
using System.Windows.Media;

namespace Stratus.Desktop.Views;

public partial class LicenseDialog : Window
{
    public LicenseDialog()
    {
        InitializeComponent();
        LoadCurrentLicense();
    }

    private void LoadCurrentLicense()
    {
        var license = App.LicenseService.GetLicense();
        if (license != null && license.IsValid && license.Key != "TRIAL")
        {
            // Show read-only active licence view
            ActiveLicensePanel.Visibility = Visibility.Visible;
            ActivationPanel.Visibility = Visibility.Collapsed;

            ActiveKeyText.Text = license.Key;
            ActiveTypeText.Text = license.Type.ToString();
            ActiveHolderText.Text = license.LicenseHolder ?? "—";
            ActiveOrgText.Text = license.Organization ?? "—";
            ActiveStationsText.Text = license.MaxStations.ToString();
            ActiveExpiryText.Text = license.ExpiryDate.HasValue
                ? license.ExpiryDate.Value.ToString("yyyy-MM-dd")
                : "Lifetime";
        }
        else
        {
            // Show activation form
            ActiveLicensePanel.Visibility = Visibility.Collapsed;
            ActivationPanel.Visibility = Visibility.Visible;

            if (license != null)
            {
                LicenseTypeText.Text = $"Type: {license.Type} | Max Stations: {license.MaxStations}";
                LicenseExpiryText.Text = license.ExpiryDate.HasValue
                    ? $"Expires: {license.ExpiryDate.Value:yyyy-MM-dd}"
                    : "No expiry";

                if (license.LicenseHolder != null)
                    HolderNameBox.Text = license.LicenseHolder;
                if (license.Organization != null)
                    OrganizationBox.Text = license.Organization;
            }
            else
            {
                LicenseTypeText.Text = "No licence activated";
                LicenseExpiryText.Text = "";
            }
        }
    }

    private void ChangeLicense_Click(object sender, RoutedEventArgs e)
    {
        // Switch to activation view so user can enter a new key
        ActiveLicensePanel.Visibility = Visibility.Collapsed;
        ActivationPanel.Visibility = Visibility.Visible;

        var license = App.LicenseService.GetLicense();
        if (license != null)
        {
            LicenseKeyBox.Text = "";
            HolderNameBox.Text = license.LicenseHolder ?? "";
            OrganizationBox.Text = license.Organization ?? "";
            LicenseTypeText.Text = $"Type: {license.Type} | Max Stations: {license.MaxStations}";
            LicenseExpiryText.Text = license.ExpiryDate.HasValue
                ? $"Expires: {license.ExpiryDate.Value:yyyy-MM-dd}"
                : "No expiry";
        }
    }

    private void Activate_Click(object sender, RoutedEventArgs e)
    {
        var key = LicenseKeyBox.Text.Trim();
        var holder = HolderNameBox.Text.Trim();
        var org = OrganizationBox.Text.Trim();

        if (string.IsNullOrEmpty(key))
        {
            ActivationStatus.Text = "Please enter a licence key.";
            ActivationStatus.Foreground = FindResource("DangerBrush") as Brush ?? Brushes.Red;
            return;
        }

        var result = App.LicenseService.ActivateLicense(key, holder, org);

        ActivationStatus.Text = result.Message;
        ActivationStatus.Foreground = result.Success
            ? (FindResource("SuccessBrush") as Brush ?? Brushes.Green)
            : (FindResource("DangerBrush") as Brush ?? Brushes.Red);

        if (result.Success)
            LoadCurrentLicense();
    }

    private void Close_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }
}
