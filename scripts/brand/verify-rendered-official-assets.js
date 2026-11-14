const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../..");
// Exact assets from v2.5.0 across the renderer, shell, installer and extension.
const hashes = {
  "assets/icon.ico": "0e9eff52805add54505211e4a21cf12bafaaf5b4a1c189b9d85d3121c6637aaa",
  "assets/icon.png": "4b36e740961f3be925f12dfe62e663c23541a33f31d87114fd2627aeeaa7efb8",
  "assets/tray-icon.png": "05ba018e6e3df55385aac5fe728050a48297bb0329afceeee9b0d135bbca5b54",
  "assets/installerHeader.bmp": "dd6d813d8b4b5edd96a1ba17749e558c1ec04248bf1e49327e839f2fc31e2bdc",
  "assets/installerSidebar.bmp": "6447702005f1a98868731644ad648f4ac36affef50defb2381250684404c2acb",
  "assets/brand/symbol-black.png": "6a9191d07865fc75c6a8d059b03c313fc75551eecfb4b77c7f6d0aa5c795b651",
  "assets/brand/wordmark-black.png": "74c550d5b206bbfa8848bd1ab484c15cabffcc829540dee799da74da081803bd",
  "assets/brand/lockup-horizontal-black.png": "3d2eefe9a1a35cfd1c99bcfcf4f16bf6c4c062953b1846c705933e6f6dbbb4d4",
  "assets/brand/lockup-horizontal-white.png": "fc1faf7a77aae3a10b6ba8fc4b36ed5402d097c29175af4b0b820c5f656e064e",
  "public/icon.png": "e209b5174254725ef481659cd651642611aeac385a37d6a81860db1ac762f5c5",
  "src/extension/icons/icon16.png": "a395e65d1eb4b1b9aac861ff1eb8628ac27fe65768abce66eabca4435400e667",
  "src/extension/icons/icon48.png": "e056e3b1c287024740c9ca4c46e95ff7c03f8c427dae592483b774a75a344f94",
  "src/extension/icons/icon128.png": "09f9351c7ba19167d8406b7e3e7b55ef941603a261bd313e10d801be38399155",
  "src/extension/icons/wordmark.png": "198b620e01a8f0e2bcb460f60a4daa190592b0673be215fc06feb19a588c5109"
};

function verifyBranding() {
  for (const [file, expected] of Object.entries(hashes)) {
    const actual = createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex");
    assert.equal(actual, expected, "GetANNY v2.5.0 artwork changed: " + file);
  }
}

if (require.main === module) {
  verifyBranding();
  console.log("Exact GetANNY v2.5.0 desktop, tray, installer and extension artwork verified.");
}
module.exports = { verifyBranding };
