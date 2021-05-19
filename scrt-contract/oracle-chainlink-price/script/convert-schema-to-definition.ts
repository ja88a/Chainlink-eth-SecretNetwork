import { writeFileSync } from 'fs';
import { compileFromFile, Options } from 'json-schema-to-typescript';

async function generate() {
  writeFileSync('dist/types/oracle-contract.d.ts', await compileFromFile('dist/types/oracle-contract.json'));
}

generate();


//import { outputFileSync } from 'fs-extra';

// const schemasDir = 'schema';
// const typesDir = 'dist';
// const indexFile = 'convert-schema-to-definition.d.ts';
// const indexPath = `${typesDir}/${indexFile}`;
// const exportFile = 'contract.d.ts';
// const exportPath = `${typesDir}/${exportFile}`;

// export function buildTypes(): Promise<any> {
//     // Clean the typings directory
//     cleanDirectory(typesDir);

//     // When compilation is finished
//     return compileFromDir(schemasDir, compilationOptions).then(
//         definitions => {
//             // Build a global definition files
//             const globalOutput = definitions.map(definition => definition.definition);
//             outputFileSync(indexPath, globalOutput.join('\n'));

//             // Generate an index file
//             const exportFileOutput = definitions.map(definition => {
//                 // Remove root directory
//                 let exportPath = definition.filepath.replace(schemasDir, '.');

//                 // Remove extension for export
//                 exportPath = exportPath.replace('.json', '');

//                 return `export * from '${exportPath}';`;
//             });
//             outputFileSync(exportPath, exportFileOutput.join('\n'));

//             // Generate the definitions files
//             return definitions.map(definition => {
//                 let filepath = definition.filepath.replace(`${schemasDir}/`, '');
//                 // Remove extension
//                 filepath = filepath.replace('.json', '.d.ts');

//                 // Retrieve definition output
//                 const definitionOutput = definition.definition;

//                 const definitionPath = `${typesDir}/${filepath}`;

//                 outputFileSync(definitionPath, definitionOutput);
//             });
//         },
//         // Failed
//         error => console.error(error)
//     );
// }

// // Make sure a directory exists and is empty
// export function cleanDirectory(dir: string, destructive = true): void {
//     if (existsSync(dir)) {
//         if (destructive) {
//             removeSync(dir);
//         } else {
//             throw new Error(`'${dir}' directory exists and should not be deleted (non-destructive call)`);
//         }
//     }
//     mkdirSync(dir);
// }

// export const compilationOptions: Partial<Options> = {
//     bannerComment: '',
//     declareExternallyReferenced: false,
//     enableConstEnums: true,
//     style: {
//         semi: true,
//         tabWidth: 4,
//         singleQuote: true,
//         trailingComma: 'es5',
//         bracketSpacing: true,
//     },
//     unreachableDefinitions: true,
// };