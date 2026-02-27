using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Views;

public partial class AuditLogWindow : Window
{
    public AuditLogWindow()
    {
        InitializeComponent();

        // Default date range: last 7 days
        AuditTo.SelectedDate = DateTime.Now;
        AuditFrom.SelectedDate = DateTime.Now.AddDays(-7);

        // Populate category filter
        var categories = new List<string> { "All" };
        categories.AddRange(Enum.GetNames<AuditCategory>());
        CategoryFilter.ItemsSource = categories;
        CategoryFilter.SelectedIndex = 0;

        LoadEntries();
    }

    private void LoadEntries()
    {
        if (App.AuditService == null) return;

        var from = AuditFrom.SelectedDate ?? DateTime.Now.AddDays(-7);
        var to = (AuditTo.SelectedDate ?? DateTime.Now).AddDays(1); // Include full day

        var entries = App.AuditService.GetEntries(from, to);

        // Apply category filter
        var selectedCategory = CategoryFilter.SelectedItem?.ToString();
        if (!string.IsNullOrEmpty(selectedCategory) && selectedCategory != "All")
        {
            if (Enum.TryParse<AuditCategory>(selectedCategory, out var cat))
                entries = entries.Where(e => e.Category == cat).ToList();
        }

        AuditGrid.ItemsSource = entries;
        EntryCountText.Text = $"{entries.Count:N0} entries";
    }

    private void Refresh_Click(object sender, RoutedEventArgs e) => LoadEntries();

    private void CategoryFilter_Changed(object sender, SelectionChangedEventArgs e) => LoadEntries();

    private void ExportCsv_Click(object sender, RoutedEventArgs e)
    {
        var entries = AuditGrid.ItemsSource as IEnumerable<AuditEntry>;
        if (entries == null || !entries.Any())
        {
            MessageBox.Show("No entries to export.", "Empty", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var dialog = new SaveFileDialog
        {
            Title = "Export Audit Log",
            Filter = "CSV Files (*.csv)|*.csv",
            FileName = $"AuditLog_{DateTime.Now:yyyyMMdd}.csv"
        };

        if (dialog.ShowDialog() != true) return;

        try
        {
            using var writer = new StreamWriter(dialog.FileName);
            writer.WriteLine("Timestamp,Category,Action,Details,User,StationId");
            foreach (var entry in entries)
            {
                var details = entry.Details.Replace("\"", "\"\"");
                writer.WriteLine($"\"{entry.Timestamp:O}\",\"{entry.Category}\",\"{entry.Action}\",\"{details}\",\"{entry.User}\",\"{entry.StationId}\"");
            }

            MessageBox.Show("Audit log exported successfully.", "Export Complete",
                MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Export failed: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
