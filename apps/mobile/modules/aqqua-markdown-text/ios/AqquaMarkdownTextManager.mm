#import <React/RCTViewManager.h>
#import <React/RCTUIManager.h>
#import "RCTBridge.h"
#import "Utils.h"

@interface AqquaMarkdownTextManager : RCTViewManager
@end

@implementation AqquaMarkdownTextManager

RCT_EXPORT_MODULE(AqquaMarkdownText)

- (UIView *)view
{
  return [[UIView alloc] init];
}

RCT_CUSTOM_VIEW_PROPERTY(color, NSString, UIView)
{
}

@end

@interface AqquaMarkdownTextRunManager : RCTViewManager
@end

@implementation AqquaMarkdownTextRunManager

RCT_EXPORT_MODULE(AqquaMarkdownTextRun)

- (UIView *)view
{
  return nil;
}

@end
