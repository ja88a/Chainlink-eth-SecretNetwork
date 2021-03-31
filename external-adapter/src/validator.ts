import { AdapterError } from './errors'
import { Requester } from './requester'
import { logger } from './logger'
import { AdapterErrorResponse } from '@chainlink/types'

export class Validator {
  input: any
  customParams: any
  validated: any
  error: AdapterError | undefined
  errored: AdapterErrorResponse | undefined

  constructor(input = {}, customParams = {}) {
    this.input = input
    this.customParams = customParams
    this.validated = { data: {} }
    this.validateInput()
  }

  validateInput() {
    this.input.id = this.input.id || '1'
    this.validated.id = this.input.id

    try {
      for (const key in this.customParams) {
        if (Array.isArray(this.customParams[key])) {
          this.validateRequiredParam(this.getRequiredArrayParam(this.customParams[key]), key)
        } else if (this.customParams[key] === true) {
          this.validateRequiredParam(this.input.data[key], key)
        } else if (typeof this.input.data[key] !== 'undefined') {
          this.validated.data[key] = this.input.data[key]
        }
      }
    } catch (error) {
      const message = 'Error validating input.'
      if (error instanceof AdapterError) this.error = error
      else
        this.error = new AdapterError({
          jobRunID: this.validated.id,
          statusCode: 400,
          message,
          cause: error,
        })
      logger.error(message, { error: this.error })
      this.errored = Requester.errored(this.validated.id, this.error)
    }
  }

  validateRequiredParam(param: any, key: string) {
    if (typeof param === 'undefined') {
      const message = `Required parameter not supplied: ${key}`
      throw new AdapterError({ jobRunID: this.validated.id, statusCode: 400, message })
    } else {
      this.validated.data[key] = param
    }
  }

  getRequiredArrayParam(keyArray: string[]) {
    for (const param of keyArray) {
      if (typeof this.input.data[param] !== 'undefined') {
        return this.input.data[param]
      }
    }
  }
}
