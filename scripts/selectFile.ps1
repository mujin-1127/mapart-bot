Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Filter = "NBT files (*.nbt)|*.nbt|All files (*.*)|*.*"
$f.Title = "請選擇地圖畫投影檔 (.nbt)"
$f.InitialDirectory = [System.IO.Directory]::GetCurrentDirectory()
$res = $f.ShowDialog()
if ($res -eq "OK") {
    Write-Host $f.FileName
} else {
    Write-Host ""
}
