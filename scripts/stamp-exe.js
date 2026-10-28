// Sets Offbeat.exe's icon and version info without Wine (used when building on Linux/macOS).
const fs = require('fs'); const path = require('path');
const ResEdit = require('resedit');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
async function stamp(exePath) {
  const pkg = require('../package.json');
  const ico = await pngToIco([16, 24, 32, 48, 64, 128, 256].map(s => path.join(__dirname, '../build/icon-' + s + '.png')));
  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = ResEdit.NtExecutableResource.from(exe);
  const iconFile = ResEdit.Data.IconFile.from(ico);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries);
  const groupId = groups.length ? groups[0].id : 1;
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, groupId, 1033, iconFile.icons.map(i => i.data));
  const vi = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0];
  const v = pkg.version.split('.').map(Number);
  vi.setFileVersion(v[0], v[1], v[2], 0, 1033);
  vi.setProductVersion(v[0], v[1], v[2], 0, 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: 'Offbeat', FileDescription: 'Offbeat screenwriting', CompanyName: 'Offbeat',
    InternalName: 'Offbeat', OriginalFilename: 'Offbeat.exe', LegalCopyright: 'GPL-3.0-or-later'
  });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('  • stamped icon and version info', path.basename(exePath));
}
module.exports = stamp;
// electron-builder afterPack hook
module.exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'win32') return;
  await stamp(path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + '.exe'));
};
if (require.main === module) stamp(process.argv[2]).catch(e => { console.error(e); process.exit(1); });
