# MediaPipe Tasks Vision 0.10.14 (vendorizado)

Recorte do fundo da foto de perfil da profissional (`src/ui/foto-perfil.js`), carregado só no cadastro, quando a pessoa escolhe a foto.

- Pacote npm `@mediapipe/tasks-vision@0.10.14` (Apache-2.0): `vision_bundle.mjs` e `wasm/vision_wasm_internal.{js,wasm}`, sem alteração. Só a variante com SIMD foi trazida; aparelho sem SIMD cai no caminho "sem recorte".
- Modelos (Apache-2.0), de `storage.googleapis.com/mediapipe-models`: `image_segmenter/selfie_segmenter/float16/latest` e `face_detector/blaze_face_short_range/float16/latest`, baixados em 18/11/2026.

SHA-256:

```
e77f281f9619150d937023c355bae170e9120e3b9e43f1e23a2a7bee07197669  vision_bundle.mjs
9440cf0cc0cea21800e31581ec32aeedcc5fbf9df4509796bbc7d3f99e52ab9c  wasm/vision_wasm_internal.js
f82a8e6c05e08a44cc9f9e7ec5f845935bcbb1b1500ebe8c2f4812fb4e2917dc  wasm/vision_wasm_internal.wasm
b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f  modelos/blaze_face_short_range.tflite
191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b  modelos/selfie_segmenter.tflite
```
