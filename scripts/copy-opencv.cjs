const fs=require('node:fs');const path=require('node:path');
const source=require.resolve('@techstark/opencv-js/dist/opencv.js');
fs.mkdirSync(path.join(__dirname,'../public/cv'),{recursive:true});
fs.copyFileSync(source,path.join(__dirname,'../public/cv/opencv.js'));
