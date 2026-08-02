#pragma once

#include "AqquaMarkdownTextShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using AqquaMarkdownTextComponentDescriptor = ConcreteComponentDescriptor<AqquaMarkdownTextShadowNode>;

void AqquaMarkdownTextSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
