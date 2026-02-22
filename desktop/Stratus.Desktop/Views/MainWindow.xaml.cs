using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using Stratus.Desktop.ViewModels;

namespace Stratus.Desktop.Views;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        // Register value converters
        Resources.Add("BoolToColorConverter", new BoolToColorConverter());
        Resources.Add("BoolToCollectionText", new BoolToCollectionTextConverter());
        
        InitializeComponent();
    }

    private async void Login_Click(object sender, RoutedEventArgs e)
    {
        if (DataContext is MainViewModel vm)
        {
            await vm.LoginCommand.ExecuteAsync(PasswordBox.Password);
        }
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        Application.Current.Shutdown();
    }

    private void ConnectDb_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new DatabaseConnectionDialog { Owner = this };
        if (dialog.ShowDialog() == true && DataContext is MainViewModel vm)
        {
            _ = vm.ConnectDatabaseCommand.ExecuteAsync(dialog.ConnectionString);
        }
    }

    private void DisconnectDb_Click(object sender, RoutedEventArgs e)
    {
        App.DatabaseService.Disconnect();
    }

    private void License_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new LicenseDialog { Owner = this };
        dialog.ShowDialog();
    }

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new SettingsDialog { Owner = this };
        dialog.ShowDialog();
    }

    private void About_Click(object sender, RoutedEventArgs e)
    {
        var version = typeof(App).Assembly.GetName().Version;
        MessageBox.Show(
            $"Stratus Weather Station Manager\n" +
            $"Version {version}\n\n" +
            $"Research-grade weather station data acquisition\n" +
            $"and monitoring software.\n\n" +
            $"© 2025-2026 Lukas Esterhuizen. All rights reserved.\n\n" +
            $"Built with .NET 8, WPF, Npgsql",
            "About Stratus", MessageBoxButton.OK, MessageBoxImage.Information);
    }

}

/// <summary>
/// Converts bool to color (green for connected, red for disconnected).
/// </summary>
public class BoolToColorConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is true
            ? new SolidColorBrush(Color.FromRgb(0x27, 0xAE, 0x60))
            : new SolidColorBrush(Color.FromRgb(0xE7, 0x4C, 0x3C));
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}

/// <summary>
/// Converts collection state to button text.
/// </summary>
public class BoolToCollectionTextConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        return value is true ? "Stop Collection" : "Start Collection";
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
