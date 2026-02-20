using System.Windows;
using Stratus.Desktop.Services;

namespace Stratus.Desktop.Views;

public partial class DatabaseConnectionDialog : Window
{
    public string ConnectionString { get; private set; } = string.Empty;

    public DatabaseConnectionDialog()
    {
        InitializeComponent();
    }

    private async void TestConnection_Click(object sender, RoutedEventArgs e)
    {
        StatusText.Text = "Testing connection...";
        StatusText.Foreground = FindResource("TextSecondaryBrush") as System.Windows.Media.Brush;

        var (success, message) = await DatabaseService.TestConnectionAsync(ConnectionStringBox.Text);

        if (success)
        {
            StatusText.Text = $"✓ {message}";
            StatusText.Foreground = FindResource("SuccessBrush") as System.Windows.Media.Brush;
        }
        else
        {
            StatusText.Text = $"✗ {message}";
            StatusText.Foreground = FindResource("DangerBrush") as System.Windows.Media.Brush;
        }
    }

    private void Connect_Click(object sender, RoutedEventArgs e)
    {
        ConnectionString = ConnectionStringBox.Text;
        DialogResult = true;
        Close();
    }

    private void Cancel_Click(object sender, RoutedEventArgs e)
    {
        DialogResult = false;
        Close();
    }
}
