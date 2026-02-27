using System.Windows;
using System.Windows.Controls;
using Stratus.Desktop.Models;

namespace Stratus.Desktop.Views;

public partial class QualityRulesDialog : Window
{
    private readonly Services.QualityFlagService _qcService;

    public QualityRulesDialog()
    {
        InitializeComponent();
        _qcService = App.QualityFlagService;
        LoadRules();
    }

    private void LoadRules()
    {
        RulesGrid.ItemsSource = null;
        RulesGrid.ItemsSource = _qcService.Rules.ToList();
    }

    private void RulesGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (RulesGrid.SelectedItem is QualityRule rule)
        {
            EditPanel.IsEnabled = true;
            SensorCombo.ItemsSource = new[] { rule.DisplayName };
            SensorCombo.SelectedIndex = 0;
            TxtRangeMin.Text = rule.RangeMin?.ToString("F1") ?? "";
            TxtRangeMax.Text = rule.RangeMax?.ToString("F1") ?? "";
            TxtSuspectMin.Text = rule.SuspectMin?.ToString("F1") ?? "";
            TxtSuspectMax.Text = rule.SuspectMax?.ToString("F1") ?? "";
            TxtMaxRate.Text = rule.MaxRateOfChange?.ToString("F1") ?? "";
            TxtMaxRateBad.Text = rule.MaxRateOfChangeBad?.ToString("F1") ?? "";
            TxtPersistence.Text = rule.PersistenceLimit?.ToString() ?? "";
            ChkEnabled.IsChecked = rule.IsEnabled;
        }
        else
        {
            EditPanel.IsEnabled = false;
        }
    }

    private void ApplyRule_Click(object sender, RoutedEventArgs e)
    {
        if (RulesGrid.SelectedItem is not QualityRule rule) return;

        rule.RangeMin = ParseNullableDouble(TxtRangeMin.Text);
        rule.RangeMax = ParseNullableDouble(TxtRangeMax.Text);
        rule.SuspectMin = ParseNullableDouble(TxtSuspectMin.Text);
        rule.SuspectMax = ParseNullableDouble(TxtSuspectMax.Text);
        rule.MaxRateOfChange = ParseNullableDouble(TxtMaxRate.Text);
        rule.MaxRateOfChangeBad = ParseNullableDouble(TxtMaxRateBad.Text);
        rule.PersistenceLimit = int.TryParse(TxtPersistence.Text, out var p) ? p : null;
        rule.IsEnabled = ChkEnabled.IsChecked == true;

        _qcService.UpdateRule(rule);
        LoadRules();
    }

    private void AddRule_Click(object sender, RoutedEventArgs e)
    {
        var allFields = Services.QualityFlagService.GetAllSensorFields();
        var existing = _qcService.Rules.Select(r => r.SensorField).ToHashSet();
        var available = allFields.Where(f => !existing.Contains(f.Field)).ToList();

        if (available.Count == 0)
        {
            MessageBox.Show("All available sensor fields already have rules.", "No More Fields",
                MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        // Simple picker — use first available field
        var pick = available[0];
        var newRule = new QualityRule
        {
            SensorField = pick.Field,
            DisplayName = pick.Display,
            Unit = pick.Unit,
            IsEnabled = true
        };
        _qcService.AddRule(newRule);
        LoadRules();

        // Select the new rule
        RulesGrid.SelectedItem = RulesGrid.Items.Cast<QualityRule>()
            .FirstOrDefault(r => r.SensorField == newRule.SensorField);
    }

    private void RemoveRule_Click(object sender, RoutedEventArgs e)
    {
        if (RulesGrid.SelectedItem is not QualityRule rule) return;
        if (MessageBox.Show($"Remove QC rule for {rule.DisplayName}?", "Confirm",
                MessageBoxButton.YesNo, MessageBoxImage.Question) == MessageBoxResult.Yes)
        {
            _qcService.RemoveRule(rule.SensorField);
            LoadRules();
        }
    }

    private void ResetDefaults_Click(object sender, RoutedEventArgs e)
    {
        if (MessageBox.Show("Replace all rules with WMO defaults?", "Reset Rules",
                MessageBoxButton.YesNo, MessageBoxImage.Warning) == MessageBoxResult.Yes)
        {
            _qcService.ResetToDefaults();
            LoadRules();
        }
    }

    private void SaveClose_Click(object sender, RoutedEventArgs e)
    {
        _qcService.SaveRules();
        App.AuditService.Log(AuditCategory.System, "QC rules updated",
            $"{_qcService.Rules.Count(r => r.IsEnabled)} active rules");
        DialogResult = true;
    }

    private static double? ParseNullableDouble(string text)
        => double.TryParse(text, out var v) ? v : null;
}
