#pragma once

#include "AqquaMarkdownTextRunShadowNode.h"

#include <react/renderer/core/ConcreteComponentDescriptor.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {
using AqquaMarkdownTextRunComponentDescriptor = ConcreteComponentDescriptor<AqquaMarkdownTextRunShadowNode>;

void AqquaMarkdownTextRunSpec_registerComponentDescriptorsFromCodegen(
  std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);
}
