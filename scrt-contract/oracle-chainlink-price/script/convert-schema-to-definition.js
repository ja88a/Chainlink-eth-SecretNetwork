const compileSchemas = require('compile-schemas-to-typescript')

(async () => {
    try {
        await compileSchemas('./schema', './dist/types')
    } catch (err) {
        console.error(err)
        process.exit(1)
    }
})()