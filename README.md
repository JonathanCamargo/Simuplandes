# Simuplandes
**Software para simulación de sistemas mecánicos multicuerpo planares simples.**<br>

## Inicio rápido
Siga los siguientes pasos para correr Simuplandes. Requiere Node.js ≥ 22.12.

### Clonar el repositorio
```sh
git clone https://github.com/j-arb/SimuplAndes.git
cd ./SimuplAndes/simuplandes
```

### Instalar las dependencias
```sh
npm install
```

### Ejecutar Simuplandes
```sh
npm run dev
```
(`npm start` sigue funcionando como alias.)

### Verificación
Antes de aportar cambios, corra:
```sh
npm run check
```
Esto encadena lint (ESLint), formato (Prettier), tipos (TypeScript) y pruebas (Vitest con cobertura). También:
```sh
npm run build
```
para producir el bundle de producción.

La documentación de desarrollo (arquitectura, motor cinemático, puente con GraphThe y decisiones de diseño) está en [`docs/`](docs/README.md).

## Reconocimientos
La semilla de Simuplandes fue el trabajo de **Juan Esteban Arboleda Restrepo** como proyecto de grado de Ingeniería Mecánica en la Universidad de Los Andes, Colombia. Agradecemos su contribucion al planteamiento del software, interfaz grafica y primera version. Su código de la v0.1 vive en `simuplandes/src/legacy` como referencia únicamente; no se compila ni se prueba.

## Licencia
Este proyecto se rige por la licencia "MIT". Puede encontrar una copia de la licencia en el archivo [LICENCE](/LICENSE) de este repositorio.
