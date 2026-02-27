using System.Windows;
using Stratus.Desktop.Services;

namespace Stratus.Desktop.Views;

public partial class UpdateDialog : Window
{
    private UpdateInfo? _updateInfo;

    public UpdateDialog()
    {
        InitializeComponent();
        CurrentVersionText.Text = $"Current version: v{App.UpdateService?.CurrentVersion}";
        Loaded += async (_, _) => await CheckForUpdate();
    }

    private async Task CheckForUpdate()
    {
        if (App.UpdateService == null)
        {
            StatusText.Text = "Update service not available";
            return;
        }

        try
        {
            _updateInfo = await App.UpdateService.CheckForUpdateAsync();

            if (_updateInfo == null)
            {
                StatusText.Text = "Could not check for updates";
                return;
            }

            if (_updateInfo.IsNewer)
            {
                StatusText.Text = "A new version is available!";
                VersionText.Text = $"Version {_updateInfo.Version} ({_updateInfo.TagName})";
                PublishedText.Text = _updateInfo.PublishedAt;

                if (!string.IsNullOrWhiteSpace(_updateInfo.ReleaseNotes))
                {
                    NotesLabel.Visibility = Visibility.Visible;
                    NotesScroller.Visibility = Visibility.Visible;
                    ReleaseNotes.Text = _updateInfo.ReleaseNotes;
                }

                if (!string.IsNullOrEmpty(_updateInfo.DownloadUrl))
                {
                    DownloadBtn.Visibility = Visibility.Visible;
                    if (_updateInfo.FileSize > 0)
                        DownloadBtn.Content = $"Download & Install ({_updateInfo.FileSize / 1024 / 1024} MB)";
                }
            }
            else
            {
                StatusText.Text = "You are running the latest version!";
                StatusText.Foreground = new System.Windows.Media.SolidColorBrush(
                    System.Windows.Media.Color.FromRgb(0x1D, 0x4E, 0xD8));
                VersionText.Text = $"v{_updateInfo.Version} is current";
            }
        }
        catch (Exception ex)
        {
            StatusText.Text = $"Error: {ex.Message}";
        }
    }

    private async void Download_Click(object sender, RoutedEventArgs e)
    {
        if (_updateInfo == null || App.UpdateService == null) return;

        DownloadBtn.IsEnabled = false;
        ProgressBar.Visibility = Visibility.Visible;

        App.UpdateService.DownloadProgressChanged += (_, progress) =>
        {
            Dispatcher.Invoke(() =>
            {
                ProgressBar.Value = progress;
                ProgressText.Text = $"{progress}%";
            });
        };

        var path = await App.UpdateService.DownloadUpdateAsync(_updateInfo);

        if (path != null)
        {
            var result = MessageBox.Show(
                "Update downloaded. Install now? The application will restart.",
                "Install Update", MessageBoxButton.YesNo, MessageBoxImage.Question);

            if (result == MessageBoxResult.Yes)
            {
                UpdateService.LaunchInstallerAndExit(path);
            }
        }
        else
        {
            ProgressText.Text = "Download failed";
            DownloadBtn.IsEnabled = true;
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
