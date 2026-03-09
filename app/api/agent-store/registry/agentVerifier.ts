/**
 * Agent Verification Service
 * Validates agent metadata and endpoints
 */

import { ERC8004AgentCard, VerificationResult } from '../types'

/**
 * Agent Verification Service
 */
export class AgentVerifier {
  /**
   * Verify agent metadata
   */
  verifyMetadata(metadata: ERC8004AgentCard): VerificationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Check required fields
    if (!metadata.name) {
      errors.push('Missing required field: name')
    }

    if (!metadata.description) {
      errors.push('Missing required field: description')
    }

    // Validate endpoint
    if (!metadata.services && !metadata.endpoints) {
      errors.push('Missing required field: services or endpoints')
    }

    const services = metadata.services || metadata.endpoints || []
    if (services.length === 0) {
      errors.push('Services array is empty')
    }

    const primaryEndpoint = services[0]?.endpoint
    if (!primaryEndpoint) {
      errors.push('No valid endpoint found in services')
    } else {
      // Validate endpoint format
      try {
        new URL(primaryEndpoint)
      } catch {
        errors.push(`Invalid endpoint format: ${primaryEndpoint}`)
      }
    }

    // Validate capabilities
    if (!metadata.capabilities || metadata.capabilities.length === 0) {
      warnings.push('No capabilities defined')
    }

    // Validate protocols
    if (!metadata.protocols || metadata.protocols.length === 0) {
      warnings.push('No protocols defined')
    }

    // Validate version
    if (!metadata.version) {
      warnings.push('No version defined')
    }

    // Validate pricing
    if (metadata.pricing) {
      if (metadata.pricing.type && !['free', 'paid', 'subscription'].includes(metadata.pricing.type)) {
        warnings.push(`Invalid pricing type: ${metadata.pricing.type}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata,
    }
  }

  /**
   * Verify endpoint accessibility
   */
  async verifyEndpoint(endpoint: string): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

      const response = await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })

      clearTimeout(timeoutId)

      return response.ok || response.status === 404 // Allow 404 for agent not found
    } catch (error) {
      console.error('Error verifying endpoint:', error)
      return false
    }
  }

  /**
   * Verify agent metadata and endpoint
   */
  async verifyAgent(
    metadata: ERC8004AgentCard,
    endpoint?: string
  ): Promise<VerificationResult> {
    const result = this.verifyMetadata(metadata)

    // If endpoint is provided, verify it
    if (endpoint && result.valid) {
      const endpointValid = await this.verifyEndpoint(endpoint)
      if (!endpointValid) {
        result.errors.push(`Endpoint verification failed: ${endpoint}`)
        result.valid = false
      }
    }

    return result
  }

  /**
   * Validate agent name
   */
  validateName(name: string): boolean {
    if (!name || name.trim().length === 0) {
      return false
    }

    if (name.length > 100) {
      return false
    }

    return /^[a-zA-Z0-9_-]+$/.test(name)
  }

  /**
   * Validate capabilities
   */
  validateCapabilities(capabilities: string[]): boolean {
    if (!capabilities || capabilities.length === 0) {
      return false
    }

    if (capabilities.length > 50) {
      return false
    }

    return capabilities.every(cap => {
      return cap.length > 0 && cap.length <= 50
    })
  }

  /**
   * Validate rating
   */
  validateRating(rating: number): boolean {
    return rating >= 1 && rating <= 5
  }
}

/**
 * Create verifier instance
 */
export function createAgentVerifier(): AgentVerifier {
  return new AgentVerifier()
}
