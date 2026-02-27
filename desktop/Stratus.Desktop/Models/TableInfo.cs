namespace Stratus.Desktop.Models;

/// <summary>
/// UI-friendly table definition for the Station Configuration Wizard.
/// </summary>
public class TableInfo
{
    public string Name { get; set; } = string.Empty;
    public List<TableFieldInfo> Fields { get; set; } = new();
    public string Interval { get; set; } = string.Empty;
    public int FieldCount => Fields.Count;
    public string FieldNames => string.Join(", ", Fields.Select(f => f.Name));
}

/// <summary>
/// UI-friendly field definition within a table.
/// </summary>
public class TableFieldInfo
{
    public string Name { get; set; } = string.Empty;
    public string Unit { get; set; } = string.Empty;

    public override string ToString() => string.IsNullOrEmpty(Unit) ? Name : $"{Name} [{Unit}]";
}
