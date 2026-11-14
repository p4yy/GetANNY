param([Parameter(Mandatory=$true)][string]$Installer, [Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference = 'Stop'
# Extract EXE resources directly. Shell association lookups can return the
# generic executable icon even when Explorer displays an embedded product icon.
# ExtractIconEx reads resources; it does not start the downloaded executable.
if ([IO.Path]::GetExtension($Installer) -ieq '.exe') {
 Add-Type -AssemblyName System.Drawing
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GetANNYExecutableIcon {
 [DllImport("shell32.dll", CharSet=CharSet.Unicode)] public static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
'@
 $large = [IntPtr]::Zero
 $small = [IntPtr]::Zero
 $icon = $null
 $bitmap = $null
 try {
  $count = [GetANNYExecutableIcon]::ExtractIconEx([IO.Path]::GetFullPath($Installer), 0, [ref]$large, [ref]$small, 1)
  if ($count -eq 0 -or $large -eq [IntPtr]::Zero) { throw 'No embedded executable icon.' }
  $icon = [Drawing.Icon]::FromHandle($large)
  $bitmap = $icon.ToBitmap()
  $bitmap.Save([IO.Path]::GetFullPath($Output), [Drawing.Imaging.ImageFormat]::Png)
 } finally {
  if ($null -ne $bitmap) { $bitmap.Dispose() }
  if ($null -ne $icon) { $icon.Dispose() }
  if ($large -ne [IntPtr]::Zero) { [void][GetANNYExecutableIcon]::DestroyIcon($large) }
  if ($small -ne [IntPtr]::Zero) { [void][GetANNYExecutableIcon]::DestroyIcon($small) }
 }
 exit 0
}
# Open the MSI database read-only. No installation, custom action, script or
# executable from the downloaded package is executed.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
public static class GetANNYMsiIcon {
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiOpenDatabase(string path,IntPtr persist,out uint database);
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiDatabaseOpenView(uint database,string query,out uint view);
 [DllImport("msi.dll")] static extern uint MsiViewExecute(uint view,uint record);
 [DllImport("msi.dll")] static extern uint MsiViewFetch(uint view,out uint record);
 [DllImport("msi.dll",CharSet=CharSet.Unicode)] static extern uint MsiRecordGetString(uint record,uint field,StringBuilder value,ref uint size);
 [DllImport("msi.dll")] static extern uint MsiRecordReadStream(uint record,uint field,byte[] data,ref uint size);
 [DllImport("msi.dll")] static extern uint MsiCloseHandle(uint handle);
 static uint Query(uint database,string sql) {
  uint view=0,record=0;
  try { if(MsiDatabaseOpenView(database,sql,out view)!=0 || MsiViewExecute(view,0)!=0 || MsiViewFetch(view,out record)!=0) return 0; return record; }
  finally { if(view!=0) MsiCloseHandle(view); }
 }
 public static void Extract(string file,string output) {
  uint db=0,record=0;
  try {
   if(MsiOpenDatabase(file,IntPtr.Zero,out db)!=0) throw new IOException("Cannot read installer metadata.");
   record=Query(db,"SELECT `Value` FROM `Property` WHERE `Property`='ARPPRODUCTICON'");
   if(record==0) throw new IOException("Installer does not declare a product icon.");
   var name=new StringBuilder(4096); uint length=4095;
   if(MsiRecordGetString(record,1,name,ref length)!=0) throw new IOException("Invalid product icon name.");
   MsiCloseHandle(record); record=0;
   record=Query(db,"SELECT `Data` FROM `Icon` WHERE `Name`='"+name.ToString().Replace("'","''")+"'");
   if(record==0) throw new IOException("Embedded product icon is missing.");
   using(var stream=new FileStream(output,FileMode.CreateNew,FileAccess.Write)) {
    var buffer=new byte[65536]; int total=0;
    while(true) { uint count=(uint)buffer.Length; if(MsiRecordReadStream(record,1,buffer,ref count)!=0) throw new IOException("Invalid icon stream."); if(count==0) break; total+=(int)count; if(total>4*1024*1024) throw new IOException("Icon exceeds the size limit."); stream.Write(buffer,0,(int)count); }
   }
  } finally { if(record!=0) MsiCloseHandle(record); if(db!=0) MsiCloseHandle(db); }
 }
}
'@
if ([IO.Path]::GetExtension($Installer) -ine '.msi') { throw 'Expected an MSI package.' }
[GetANNYMsiIcon]::Extract([IO.Path]::GetFullPath($Installer), [IO.Path]::GetFullPath($Output))
